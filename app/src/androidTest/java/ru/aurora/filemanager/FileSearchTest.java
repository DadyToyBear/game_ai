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
    @Test public void emptyQueryAndCancellationAreHandled(){
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        Uri tree=Uri.parse("content://test.provider/tree/root"),start=Uri.parse("content://test.provider/tree/root/document/root");
        CancellationSignal signal=new CancellationSignal();FileSearch search=new FileSearch(context.getContentResolver(),tree,start,signal);
        try{search.search("  ");fail("empty query");}catch(IllegalArgumentException expected){}
        signal.cancel();try{search.search("file");fail("cancelled search");}catch(OperationCanceledException expected){}
    }
}
