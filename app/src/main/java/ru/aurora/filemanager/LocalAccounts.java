package ru.aurora.filemanager;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.json.*;

/** Local HTTP server accounts. Passwords are never written to preferences. */
final class LocalAccounts {
    private static final Object LOCK=new Object();
    private static final int ITERATIONS=150000, MAX_ACCOUNTS=20;
    private final SharedPreferences preferences;
    LocalAccounts(Context context){preferences=context.getApplicationContext().getSharedPreferences("server_accounts",Context.MODE_PRIVATE);}
    private JSONObject read() throws Exception {return new JSONObject(preferences.getString("accounts","{}"));}
    private void save(JSONObject accounts) throws IOException {if(!preferences.edit().putString("accounts",accounts.toString()).commit())throw new IOException("Не удалось сохранить учётные записи");}
    static boolean validUsername(String name){return name!=null&&name.matches("[A-Za-z0-9_.-]{1,64}");}
    static void validatePassword(char[] password) throws IOException {if(password.length<8||password.length>256)throw new IOException("Пароль должен содержать от 8 до 256 символов");}
    private static byte[] hash(char[] password,byte[] salt,int iterations) throws Exception {
        PBEKeySpec spec=new PBEKeySpec(password,salt,iterations,256);
        try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();}
        finally{spec.clearPassword();}
    }
    List<String> list() throws Exception {synchronized(LOCK){JSONObject object=read();List<String> users=new ArrayList<>();Iterator<String> it=object.keys();while(it.hasNext())users.add(it.next());Collections.sort(users);return users;}}
    void add(String username,char[] password) throws Exception {add(username,password,true);}
    void add(String username,char[] password,boolean canWrite) throws Exception {
        if(!validUsername(username))throw new IOException("Имя: 1–64 латинских букв, цифр, точек, дефисов или подчёркиваний");validatePassword(password);
        byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);byte[] derived=hash(password,salt,ITERATIONS);
        try{synchronized(LOCK){JSONObject object=read();if(object.has(username))throw new IOException("Учётная запись уже существует");if(object.length()>=MAX_ACCOUNTS)throw new IOException("Максимум 20 учётных записей");
            object.put(username,new JSONObject().put("salt",Base64.encodeToString(salt,Base64.NO_WRAP)).put("hash",Base64.encodeToString(derived,Base64.NO_WRAP)).put("iterations",ITERATIONS).put("write",canWrite));save(object);
        }}finally{Arrays.fill(derived,(byte)0);}
    }

    void remove(String username) throws Exception {synchronized(LOCK){JSONObject object=read();if(!object.has(username))throw new IOException("Учётная запись не найдена");object.remove(username);save(object);}}
    boolean canWrite(String username) throws Exception {synchronized(LOCK){JSONObject entry=read().optJSONObject(username);if(entry==null)throw new IOException("Учётная запись не найдена");return entry.optBoolean("write",true);}}
    void setCanWrite(String username,boolean canWrite) throws Exception {synchronized(LOCK){JSONObject all=read(),entry=all.optJSONObject(username);if(entry==null)throw new IOException("Учётная запись не найдена");entry.put("write",canWrite);save(all);}}
    boolean verify(String username,char[] password) throws Exception {return authenticate(username,password)!=null;}
    Boolean authenticate(String username,char[] password) throws Exception {
        if(!validUsername(username)||password.length>256)return null;
        byte[] salt,expected;int iterations;boolean exists,canWrite;
        synchronized(LOCK){JSONObject all=read(),entry=all.optJSONObject(username);exists=entry!=null;canWrite=exists&&entry.optBoolean("write",true);
            if(exists){salt=Base64.decode(entry.getString("salt"),Base64.NO_WRAP);expected=Base64.decode(entry.getString("hash"),Base64.NO_WRAP);iterations=entry.getInt("iterations");if(salt.length!=16||expected.length!=32||iterations<100000||iterations>1000000)throw new IOException("Повреждены записи учётных данных");}
            else{salt=new byte[16];expected=new byte[32];iterations=ITERATIONS;}
        }
        byte[] actual=hash(password,salt,iterations);try{return MessageDigest.isEqual(expected,actual)&&exists?Boolean.valueOf(canWrite):null;}finally{Arrays.fill(actual,(byte)0);}
    }
}
