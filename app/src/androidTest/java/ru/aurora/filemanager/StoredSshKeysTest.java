package ru.aurora.filemanager;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class StoredSshKeysTest {
    @Test public void encryptedStorageRoundTripTamperingAndDelete() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String suffix=UUID.randomUUID().toString().replace("-","");String dir="ssh_test_"+suffix,alias="test_ssh_"+suffix;
        StoredSshKeys store=new StoredSshKeys(context,dir,alias);byte[] key="test private key material - never real".getBytes(java.nio.charset.StandardCharsets.UTF_8);String id=null;
        try{
            store.add("Мой ключ",key);List<StoredSshKeys.Entry> list=store.list();assertEquals(1,list.size());id=list.get(0).id;assertEquals("Мой ключ",list.get(0).name);assertTrue(list.get(0).readable);assertArrayEquals(key,store.load(id));
            File file=new File(new File(context.getFilesDir(),dir),id+".key");byte[] disk=Files.readAllBytes(file.toPath());assertFalse(new String(disk,java.nio.charset.StandardCharsets.ISO_8859_1).contains("test private key material"));
            disk[disk.length-1]^=1;Files.write(file.toPath(),disk);assertFalse(store.list().get(0).readable);
            try{store.load(id);fail("tampering must fail authentication");}catch(Exception expected){}
            store.delete(id);id=null;assertTrue(store.list().isEmpty());
        }finally{if(id!=null)try{store.delete(id);}catch(Exception ignored){}new File(context.getFilesDir(),dir).delete();KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);ks.deleteEntry(alias);Arrays.fill(key,(byte)0);}
    }
    @Test public void rejectsInvalidLabelsKeysAndIds() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();StoredSshKeys store=new StoredSshKeys(context,"unused_test_keys","unused_test_alias");
        try{store.add("",new byte[]{1});fail();}catch(java.io.IOException expected){}
        try{store.add("name",new byte[65537]);fail();}catch(java.io.IOException expected){}
        try{store.load("../bad");fail();}catch(IllegalArgumentException expected){}
    }
}
