package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.IOException;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class VideoInfoTest {
    @Test public void validatesDurationMetadata() throws Exception {
        assertEquals(12345,VideoInfo.parseDuration("12345"));
        for(String value:new String[]{null,"0","-1","not-a-number","9223372036854775807"})try{VideoInfo.parseDuration(value);fail("bad duration");}catch(IOException expected){}
    }
}
