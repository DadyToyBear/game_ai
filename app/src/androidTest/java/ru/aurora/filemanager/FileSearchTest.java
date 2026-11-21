package ru.aurora.filemanager;

import android.content.Context;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class FileSearchTest {
    @Test public void nameMatchingIsCaseInsensitiveAndPartial(){
        assertTrue(FileSearch.matches("Отчёт.TXT","отЧЁТ"));
        assertTrue(FileSearch.matches("photo.JPG",".jpg"));
        assertFalse(FileSearch.matches("photo.JPG","other"));
        assertFalse(FileSearch.matches(null,"other"));
    }
    @Test public void typeFilterDistinguishesFoldersAndFiles(){
        String dir=android.provider.DocumentsContract.Document.MIME_TYPE_DIR;
        assertTrue(FileSearch.matchesType(dir,FileSearch.Type.ALL));assertTrue(FileSearch.matchesType(dir,FileSearch.Type.FOLDERS));assertFalse(FileSearch.matchesType(dir,FileSearch.Type.FILES));
        assertTrue(FileSearch.matchesType("text/plain",FileSearch.Type.FILES));assertFalse(FileSearch.matchesType("text/plain",FileSearch.Type.FOLDERS));assertTrue(FileSearch.matchesType(null,FileSearch.Type.FILES));
    }
    @Test public void emptyQueryAndCancellationAreHandled(){
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        Uri tree=Uri.parse("content://test.provider/tree/root"),start=Uri.parse("content://test.provider/tree/root/document/root");
        CancellationSignal signal=new CancellationSignal();FileSearch search=new FileSearch(context.getContentResolver(),tree,start,signal);
        try{search.search("  ");fail("empty query");}catch(IllegalArgumentException expected){}
        signal.cancel();try{search.search("file");fail("cancelled search");}catch(OperationCanceledException expected){}
    }
}
