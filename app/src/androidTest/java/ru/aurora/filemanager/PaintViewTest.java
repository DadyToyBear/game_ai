package ru.aurora.filemanager;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PaintViewTest {
    @Test public void strokeAndUndo() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
            FrameLayout container=new FrameLayout(context);MainActivity.PaintView view=new MainActivity.PaintView(context);
            container.addView(view);view.layout(0,0,400,400);view.color=Color.RED;view.width=30;
            MotionEvent down=MotionEvent.obtain(0,0,MotionEvent.ACTION_DOWN,200,200,0);
            MotionEvent up=MotionEvent.obtain(0,1,MotionEvent.ACTION_UP,200,200,0);
            try{assertTrue(view.onTouchEvent(down));assertTrue(view.onTouchEvent(up));}finally{down.recycle();up.recycle();}
            assertEquals(Color.RED,view.bitmap.getPixel(600,600));assertTrue(view.undo());assertEquals(Color.WHITE,view.bitmap.getPixel(600,600));assertFalse(view.undo());
        });
    }
    @Test public void rotateAndMirrorCanBeUndone() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();MainActivity.PaintView view=new MainActivity.PaintView(context);
            android.graphics.Paint p=new android.graphics.Paint();p.setColor(Color.RED);new android.graphics.Canvas(view.bitmap).drawRect(100,100,200,200,p);
            assertTrue(view.transform(false));assertEquals(Color.RED,view.bitmap.getPixel(1050,150));assertEquals(Color.WHITE,view.bitmap.getPixel(150,150));
            assertTrue(view.undo());assertEquals(Color.RED,view.bitmap.getPixel(150,150));
            assertTrue(view.transform(true));assertEquals(Color.RED,view.bitmap.getPixel(1050,150));assertEquals(Color.WHITE,view.bitmap.getPixel(150,150));
            assertTrue(view.undo());assertEquals(Color.RED,view.bitmap.getPixel(150,150));
        });
    }
    @Test public void redoAndNewEditClearRedoHistory() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();MainActivity.PaintView view=new MainActivity.PaintView(context);
            android.graphics.Paint p=new android.graphics.Paint();p.setColor(Color.RED);new android.graphics.Canvas(view.bitmap).drawRect(100,100,200,200,p);
            assertTrue(view.transform(true));assertTrue(view.undo());assertEquals(Color.RED,view.bitmap.getPixel(150,150));
            assertTrue(view.redo());assertEquals(Color.RED,view.bitmap.getPixel(1050,150));assertFalse(view.redo());
            assertTrue(view.undo());view.clear();assertFalse(view.redo());assertTrue(view.undo());assertEquals(Color.RED,view.bitmap.getPixel(150,150));
        });
    }
    @Test public void importFitsWithoutStretchingAndCanUndo() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();MainActivity.PaintView view=new MainActivity.PaintView(context);
            Bitmap input=Bitmap.createBitmap(4,2,Bitmap.Config.ARGB_8888);input.eraseColor(Color.BLUE);
            try{view.importImage(input);}finally{input.recycle();}
            assertEquals(Color.BLUE,view.bitmap.getPixel(600,600));assertEquals(Color.WHITE,view.bitmap.getPixel(600,50));
            assertTrue(view.undo());assertEquals(Color.WHITE,view.bitmap.getPixel(600,600));
        });
    }
}
