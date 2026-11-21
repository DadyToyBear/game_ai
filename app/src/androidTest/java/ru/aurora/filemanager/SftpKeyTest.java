package ru.aurora.filemanager;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.KeyPair;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SftpKeyTest {
    @Test public void loadsEncryptedSavedKeyWithoutPasswordFallback() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();StoredSshKeys store=new StoredSshKeys(context);
        String label="test_"+UUID.randomUUID().toString();String id=null;byte[] data=null;
        KeyPair pair=KeyPair.genKeyPair(new JSch(),KeyPair.RSA,2048);
        try{
            ByteArrayOutputStream out=new ByteArrayOutputStream();pair.writePrivateKey(out,"test phrase".getBytes(StandardCharsets.UTF_8));data=out.toByteArray();store.add(label,data);
            for(StoredSshKeys.Entry entry:store.list())if(entry.name.equals(label)){id=entry.id;break;}assertNotNull(id);
            try{JSch unexpected=SshRunner.loadSavedIdentity(context,id,"wrong phrase");unexpected.removeAllIdentity();fail("wrong phrase accepted");}catch(Exception expected){}
            JSch identity=SshRunner.loadSavedIdentity(context,id,"test phrase");
            try{assertEquals(1,identity.getIdentityRepository().getIdentities().size());assertFalse(identity.getIdentityRepository().getIdentities().get(0).isEncrypted());
                assertNotNull(identity.getIdentityRepository().getIdentities().get(0).getSignature("data".getBytes(StandardCharsets.UTF_8)));
            }finally{identity.removeAllIdentity();}
            SftpClient.Credentials credentials=new SftpClient.Credentials("example",22,"user","",id);assertEquals(id,credentials.keyId);
            assertNull(new SftpClient.Credentials("example",22,"user","password").keyId);
        }finally{if(id!=null)store.delete(id);if(data!=null)Arrays.fill(data,(byte)0);pair.dispose();}
    }
}
