package ru.aurora.filemanager;

import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SshKeyTest {
    @Test public void loadedRsaKeysCanSignAfterInputIsCleared() throws Exception {
        com.jcraft.jsch.JSch generator=new com.jcraft.jsch.JSch();
        com.jcraft.jsch.KeyPair pair=com.jcraft.jsch.KeyPair.genKeyPair(generator,com.jcraft.jsch.KeyPair.RSA,2048);
        try{
            for(boolean encrypted:new boolean[]{false,true}){
                java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] pass="test passphrase".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                pair.writePrivateKey(out,encrypted?pass:null);byte[] encoded=out.toByteArray();com.jcraft.jsch.JSch client=new com.jcraft.jsch.JSch();
                try{client.addIdentity("test",encoded,null,encrypted?pass:null);java.util.Arrays.fill(encoded,(byte)0);java.util.Arrays.fill(pass,(byte)0);
                    com.jcraft.jsch.Identity identity=client.getIdentityRepository().getIdentities().get(0);
                    assertFalse(identity.isEncrypted());assertNotNull(identity.getSignature("message".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                }finally{client.removeAllIdentity();java.util.Arrays.fill(encoded,(byte)0);java.util.Arrays.fill(pass,(byte)0);}
            }
        }finally{pair.dispose();}
    }
    @Test public void keyReadIsBoundedAndCancellable() throws Exception {
        CancellationSignal signal=new CancellationSignal();byte[] key=new byte[65536];key[0]=42;key[key.length-1]=33;
        assertArrayEquals(key,SshRunner.readKey(new ByteArrayInputStream(key),signal));
        for(int length:new int[]{0,65537})try{SshRunner.readKey(new ByteArrayInputStream(new byte[length]),signal);fail("Invalid key size");}catch(IOException expected){}
        signal.cancel();try{SshRunner.readKey(new ByteArrayInputStream(key),signal);fail("cancelled");}catch(OperationCanceledException expected){}
    }
}
