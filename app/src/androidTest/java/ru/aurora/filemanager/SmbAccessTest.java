package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SmbAccessTest {
    @Test public void refusesUnsafePathComponents() {
        for(String name:new String[]{"", ".", "..", "../secret", "a\\b", "a/b", "file:stream", "a*", "a?", "a\nb", "file.", "file "})
            assertFalse(name,SmbAccess.safeName(name));
        assertTrue(SmbAccess.safeName("фото 2025.png"));
        assertEquals("folder\\file.txt",SmbAccess.join("folder","file.txt"));
        assertEquals("file.txt",SmbAccess.join("","file.txt"));
    }
}
