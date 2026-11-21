package ru.aurora.filemanager;

import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.IOException;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ZipSelectionTest {
    @Test public void validatesSelectionsBeforeCreatingArchive() throws Exception {
        FileOperations.Item a=new FileOperations.Item(Uri.parse("content://provider/a"),"a.txt","text/plain"),b=new FileOperations.Item(Uri.parse("content://provider/b"),"b.txt","text/plain");
        FileOperations.validateZipSelection(Arrays.asList(a,b));
        for(List<FileOperations.Item> list:Arrays.asList(Collections.<FileOperations.Item>emptyList(),Arrays.asList(a,a),Arrays.asList(a,new FileOperations.Item(Uri.parse("content://provider/c"),"a.txt","text/plain")),Arrays.asList(new FileOperations.Item(Uri.parse("content://provider/c"),"../bad","text/plain"))))
            try{FileOperations.validateZipSelection(list);fail("invalid selection");}catch(IOException expected){}
    }
}
