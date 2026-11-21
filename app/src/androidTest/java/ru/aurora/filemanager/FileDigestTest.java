package ru.aurora.filemanager;

import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class FileDigestTest {
    @Test public void sha256KnownVectorsAndCancel() throws Exception {
        CancellationSignal signal=new CancellationSignal();
        FileDigest.Result result=FileDigest.sha256(new ByteArrayInputStream("abc".getBytes(StandardCharsets.UTF_8)),signal);
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",result.sha256);assertEquals(3,result.bytes);
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",FileDigest.sha256(new ByteArrayInputStream(new byte[0]),signal).sha256);
        signal.cancel();try{FileDigest.sha256(new ByteArrayInputStream(new byte[1]),signal);fail("cancelled");}catch(OperationCanceledException expected){}
    }
}
