package ru.aurora.filemanager;

import android.graphics.Bitmap;
import android.graphics.Color;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PaintFiltersTest {
    @Test public void appliesGrayscaleAndInversionOnSnapshot(){
        Bitmap bitmap=Bitmap.createBitmap(2,1,Bitmap.Config.ARGB_8888);bitmap.setPixel(0,0,Color.RED);bitmap.setPixel(1,0,Color.WHITE);
        try{PaintFilters.apply(bitmap,true);assertEquals(Color.rgb(76,76,76),bitmap.getPixel(0,0));assertEquals(Color.WHITE,bitmap.getPixel(1,0));
            PaintFilters.apply(bitmap,false);assertEquals(Color.rgb(179,179,179),bitmap.getPixel(0,0));assertEquals(Color.BLACK,bitmap.getPixel(1,0));
        }finally{bitmap.recycle();}
        assertEquals(0x7f00ffff,PaintFilters.filterPixel(0x7fff0000,false));
    }
    @Test public void replacingSnapshotSupportsUndoAndRedo(){
        android.content.Context context=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            MainActivity.PaintView view=new MainActivity.PaintView(context);Bitmap filtered=view.bitmap.copy(Bitmap.Config.ARGB_8888,true);filtered.eraseColor(Color.BLACK);view.replaceWithSnapshot(filtered);
            assertEquals(Color.BLACK,view.bitmap.getPixel(0,0));assertTrue(view.undo());assertEquals(Color.WHITE,view.bitmap.getPixel(0,0));assertTrue(view.redo());assertEquals(Color.BLACK,view.bitmap.getPixel(0,0));
        });
    }
}
