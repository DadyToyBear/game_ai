package ru.aurora.filemanager;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import fi.iki.elonen.NanoHTTPD;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LocalAccountsTest {
    private static NanoHTTPD.IHTTPSession request(String authorization,NanoHTTPD.Method method,String path){
        Map<String,String> headers=new HashMap<>();if(authorization!=null)headers.put("authorization",authorization);
        return (NanoHTTPD.IHTTPSession)Proxy.newProxyInstance(NanoHTTPD.IHTTPSession.class.getClassLoader(),new Class[]{NanoHTTPD.IHTTPSession.class},(proxy,called,args)->{
            if(called.getName().equals("getHeaders"))return headers;
            if(called.getName().equals("getMethod"))return method;
            if(called.getName().equals("getUri"))return path;
            return null;
        });
    }
    @Test public void accountLifecycleAndServerAuthorization() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();LocalAccounts accounts=new LocalAccounts(context);
        String user="test_"+UUID.randomUUID().toString().replace("-","");char[] password="unique test password".toCharArray();
        try{
            accounts.add(user,password);assertTrue(new LocalAccounts(context).verify(user,password));assertFalse(accounts.verify(user,"incorrect password".toCharArray()));
            String saved=context.getSharedPreferences("server_accounts",Context.MODE_PRIVATE).getString("accounts","");assertFalse(saved.contains(new String(password)));
            Uri tree=Uri.parse("content://test.provider/tree/root");
            WebFilesServer authenticated=new WebFilesServer(context,tree,0,false,true,context.getCacheDir());
            String header="Basic "+Base64.encodeToString((user+":"+new String(password)).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP);
            try(NanoHTTPD.Response denied=authenticated.serve(request(null,NanoHTTPD.Method.GET,"/missing"))){assertEquals(401,denied.getStatus().getRequestStatus());}
            try(NanoHTTPD.Response allowed=authenticated.serve(request(header,NanoHTTPD.Method.GET,"/missing"))){assertEquals(404,allowed.getStatus().getRequestStatus());}
            WebFilesServer anonymous=new WebFilesServer(context,tree,0,true,true,context.getCacheDir());
            try(NanoHTTPD.Response noWrite=anonymous.serve(request(null,NanoHTTPD.Method.DELETE,"/dav/"))){assertEquals(403,noWrite.getStatus().getRequestStatus());}
            accounts.remove(user);
            try(NanoHTTPD.Response revoked=authenticated.serve(request(header,NanoHTTPD.Method.GET,"/missing"))){assertEquals(401,revoked.getStatus().getRequestStatus());}
        }finally{Arrays.fill(password,'\0');if(accounts.list().contains(user))accounts.remove(user);}
    }
    @Test public void rejectsInvalidNamesAndShortPasswords() throws Exception {
        assertFalse(LocalAccounts.validUsername("name:other"));assertFalse(LocalAccounts.validUsername("bad name"));assertTrue(LocalAccounts.validUsername("user.name-1"));
        try{LocalAccounts.validatePassword("short".toCharArray());fail("short passwords must fail");}catch(java.io.IOException expected){/* refused */}
    }
}
