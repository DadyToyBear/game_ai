package ru.aurora.filemanager;

import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class FileSortTest {
    private MainActivity.Entry entry(String name,long size,boolean dir){return new MainActivity.Entry(Uri.parse("content://test/"+name),name,dir?DocumentsContract.Document.MIME_TYPE_DIR:"text/plain",size);}
    @Test public void directoriesFirstAndUnknownSizesLast(){
        List<MainActivity.Entry> files=new ArrayList<>(Arrays.asList(entry("unknown",-1,false),entry("large",100,false),entry("small",1,false),entry("folder",-1,true)));
        files.sort(FileSort.comparator(FileSort.Mode.SIZE_DESC));assertEquals("folder",files.get(0).name);assertEquals("large",files.get(1).name);assertEquals("small",files.get(2).name);assertEquals("unknown",files.get(3).name);
        files.sort(FileSort.comparator(FileSort.Mode.SIZE_ASC));assertEquals("folder",files.get(0).name);assertEquals("small",files.get(1).name);assertEquals("large",files.get(2).name);assertEquals("unknown",files.get(3).name);
        files.sort(FileSort.comparator(FileSort.Mode.NAME_DESC));assertEquals("folder",files.get(0).name);assertEquals("unknown",files.get(1).name);
    }
}
