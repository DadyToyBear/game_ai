package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.IOException;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class CreateTextTest {
    @Test public void appendsTextExtensionAndRejectsUnsafeNames() throws Exception {
        assertEquals("note.txt",FileOperations.textName("note"));assertEquals("FILE.TXT",FileOperations.textName("FILE.TXT"));
        for(String name:new String[]{"", ".", "..", "../file", "a/b", "a\\b", "x\0y"})try{FileOperations.textName(name);fail(name);}catch(IOException expected){}
    }
}
