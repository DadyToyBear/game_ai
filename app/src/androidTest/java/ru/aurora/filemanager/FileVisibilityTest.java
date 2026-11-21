package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class FileVisibilityTest {
    @Test public void dotNamesAreOnlyHiddenWhenRequested(){
        assertTrue(FileVisibility.show(".secret",true));assertFalse(FileVisibility.show(".secret",false));assertTrue(FileVisibility.show("photo.png",false));assertTrue(FileVisibility.show(null,false));
    }
}
