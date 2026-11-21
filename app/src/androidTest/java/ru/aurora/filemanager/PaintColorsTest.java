package ru.aurora.filemanager;

import android.graphics.Color;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PaintColorsTest {
    @Test public void parsesOpaqueRgbAndRejectsInvalidValues(){
        assertEquals(Color.rgb(255,136,0),PaintColors.parse(" #fF8800 "));
        assertEquals(Color.BLACK,PaintColors.parse("000000"));
        for(String value:new String[]{"", "#123", "FF000000", "xyzxyz", "# FF0000"})try{PaintColors.parse(value);fail(value);}catch(IllegalArgumentException expected){}
    }
}
