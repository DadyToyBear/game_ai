package ru.aurora.filemanager;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayOutputStream;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PaintExportTest {
    @Test public void producesReadablePngAndJpegWithoutChangingCanvas() throws Exception {
        Bitmap bitmap=Bitmap.createBitmap(64,48,Bitmap.Config.ARGB_8888);bitmap.eraseColor(Color.RED);
        try{for(boolean jpeg:new boolean[]{false,true}){ByteArrayOutputStream out=new ByteArrayOutputStream();assertTrue(PaintExport.compress(bitmap,out,jpeg));byte[] bytes=out.toByteArray();
            if(jpeg){assertEquals(0xff,bytes[0]&255);assertEquals(0xd8,bytes[1]&255);}else{assertEquals(0x89,bytes[0]&255);assertEquals('P',bytes[1]);}
            Bitmap decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.length);assertNotNull(decoded);try{assertEquals(64,decoded.getWidth());assertEquals(48,decoded.getHeight());}finally{decoded.recycle();}
            assertEquals(Color.RED,bitmap.getPixel(0,0));
        }}finally{bitmap.recycle();}
    }
}
