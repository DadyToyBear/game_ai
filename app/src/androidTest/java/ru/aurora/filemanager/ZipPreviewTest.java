package ru.aurora.filemanager;

import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.*;
import java.util.zip.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ZipPreviewTest {
    private byte[] archive(int count) throws Exception {
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream zip=new ZipOutputStream(bytes)){
            for(int i=0;i<count;i++){zip.putNextEntry(new ZipEntry(i==0?"../unsafe.txt":"file-"+i));zip.write(new byte[]{1,2,3});zip.closeEntry();}
        }return bytes.toByteArray();
    }
    @Test public void listsWithoutExtractingAndEnforcesEntryLimit() throws Exception {
        byte[] zip=archive(501);ZipPreview.Result result=ZipPreview.list(new ByteArrayInputStream(zip),new CancellationSignal());
        assertEquals(500,result.items.size());assertTrue(result.limited);assertEquals(1500,result.scanned);assertTrue(result.items.get(0).unsafe);assertFalse(result.items.get(1).unsafe);assertEquals(3,result.items.get(0).bytes);
    }
    @Test public void sharedHeaderCheckRejectsNonZipAndPreservesBytes() throws Exception {
        byte[] original=archive(1);InputStream checked=ZipHeader.checked(new ByteArrayInputStream(original),null);
        ByteArrayOutputStream copied=new ByteArrayOutputStream();byte[] buffer=new byte[32];int n;while((n=checked.read(buffer))!=-1)copied.write(buffer,0,n);assertArrayEquals(original,copied.toByteArray());
        for(byte[] invalid:new byte[][]{new byte[0],new byte[]{'P','K',3},new byte[]{1,2,3,4}}){try{ZipHeader.checked(new ByteArrayInputStream(invalid),null);fail("invalid header");}catch(IOException expected){}}
        assertEquals('P',ZipHeader.checked(new ByteArrayInputStream(archive(0)),null).read());
    }
    @Test public void refusesInvalidInputAndHonoursCancellation() throws Exception {
        try{ZipPreview.list(new ByteArrayInputStream(new byte[]{1,2,3,4}),new CancellationSignal());fail("invalid zip");}catch(IOException expected){}
        CancellationSignal signal=new CancellationSignal();signal.cancel();try{ZipPreview.list(new ByteArrayInputStream(archive(1)),signal);fail("cancel");}catch(OperationCanceledException expected){}
        assertTrue(ZipPreview.unsafe("/absolute"));assertTrue(ZipPreview.unsafe("a\\b"));assertFalse(ZipPreview.unsafe("folder/file.txt"));assertEquals("a�b",ZipPreview.displayName("a\nb"));
    }
}
