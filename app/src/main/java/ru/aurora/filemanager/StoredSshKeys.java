package ru.aurora.filemanager;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Private SSH key files, encrypted individually with an Android Keystore AES key. */
final class StoredSshKeys {
    private static final Object LOCK=new Object();private static final int MAX_KEYS=20,MAX_FILE=67000;
    private final File directory;private final String alias;
    static final class Entry {final String id,name;final boolean readable;Entry(String id,String name,boolean readable){this.id=id;this.name=name;this.readable=readable;}}
    private static final class Data {final String name;final byte[] key;Data(String name,byte[] key){this.name=name;this.key=key;}}
    StoredSshKeys(Context context){this(context,"ssh_keys","aurora_ssh_keys_v1");}
    StoredSshKeys(Context context,String dir,String alias){this.directory=new File(context.getFilesDir(),dir);this.alias=alias;}
    private SecretKey getKey(boolean create) throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);SecretKey key=(SecretKey)store.getKey(alias,null);
        if(key==null&&create){KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());key=generator.generateKey();}
        if(key==null)throw new IOException("Ключ хранилища недоступен");return key;
    }
    private File file(String id){if(id==null||!id.matches("[0-9a-f]{32}"))throw new IllegalArgumentException("Некорректный идентификатор ключа");return new File(directory,id+".key");}
    private List<String> ids() throws IOException {if(!directory.exists())return new ArrayList<>();File[] files=directory.listFiles();if(files==null)throw new IOException("Хранилище ключей недоступно");List<String> ids=new ArrayList<>();for(File f:files)if(f.getName().matches("[0-9a-f]{32}\\.key"))ids.add(f.getName().substring(0,32));Collections.sort(ids);return ids;}
    void add(String name,byte[] key) throws Exception {
        if(name==null||name.trim().isEmpty()||name.length()>80||name.getBytes(StandardCharsets.UTF_8).length>256)throw new IOException("Имя ключа должно содержать от 1 до 80 символов");
        if(key==null||key.length==0||key.length>65536)throw new IOException("Ключ пуст или больше 64 КиБ");
        synchronized(LOCK){List<String> ids=ids();if(ids.size()>=MAX_KEYS)throw new IOException("Максимум 20 ключей");
            if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Не удалось создать хранилище");
            String id=UUID.randomUUID().toString().replace("-","");byte[] label=name.trim().getBytes(StandardCharsets.UTF_8);
            byte[] plain=ByteBuffer.allocate(4+label.length+key.length).putInt(label.length).put(label).put(key).array();
            try{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,getKey(ids.isEmpty()));cipher.updateAAD(id.getBytes(StandardCharsets.US_ASCII));
                byte[] iv=cipher.getIV(),encrypted=cipher.doFinal(plain);if(iv.length!=12)throw new IOException("Неподдерживаемый IV");
                AtomicFile output=new AtomicFile(file(id));FileOutputStream stream=output.startWrite();try{stream.write(1);stream.write(iv);stream.write(encrypted);output.finishWrite(stream);}catch(Exception ex){output.failWrite(stream);throw ex;}
            }finally{Arrays.fill(plain,(byte)0);}
        }
    }
    private Data read(String id) throws Exception {
        File target=file(id);AtomicFile input=new AtomicFile(target);byte[] encrypted;
        try(InputStream in=input.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] block=new byte[4096];int n;while((n=in.read(block))!=-1){if(out.size()+n>MAX_FILE)throw new IOException("Повреждён файл ключа");out.write(block,0,n);}encrypted=out.toByteArray();
        }
        if(encrypted.length<30||encrypted[0]!=1)throw new IOException("Повреждён файл ключа");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,getKey(false),new GCMParameterSpec(128,encrypted,1,12));cipher.updateAAD(id.getBytes(StandardCharsets.US_ASCII));
        byte[] plain=cipher.doFinal(encrypted,13,encrypted.length-13);
        try{ByteBuffer b=ByteBuffer.wrap(plain);int labelLength=b.getInt();if(labelLength<1||labelLength>256||b.remaining()<=labelLength||b.remaining()-labelLength>65536)throw new IOException("Повреждён файл ключа");
            byte[] label=new byte[labelLength];b.get(label);byte[] key=new byte[b.remaining()];b.get(key);return new Data(new String(label,StandardCharsets.UTF_8),key);
        }finally{Arrays.fill(plain,(byte)0);}
    }
    List<Entry> list() throws Exception {synchronized(LOCK){List<Entry> result=new ArrayList<>();for(String id:ids()){try{Data d=read(id);try{result.add(new Entry(id,d.name,true));}finally{Arrays.fill(d.key,(byte)0);}}catch(Exception ex){result.add(new Entry(id,"Не удалось расшифровать ключ",false));}}return result;}}
    byte[] load(String id) throws Exception {synchronized(LOCK){return read(id).key;}}
    void delete(String id) throws IOException {synchronized(LOCK){File target=file(id);if(!target.isFile())throw new IOException("Ключ не найден");new AtomicFile(target).delete();if(target.exists())throw new IOException("Не удалось удалить ключ");}}
}
