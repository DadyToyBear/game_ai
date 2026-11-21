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
public class ZoomImageViewTest {
    @Test public void clampsZoomAndSupportsDrag(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();FrameLayout container=new FrameLayout(context);ZoomImageView view=new ZoomImageView(context);container.addView(view);view.layout(0,0,300,300);
            Bitmap bitmap=Bitmap.createBitmap(100,100,Bitmap.Config.ARGB_8888);bitmap.eraseColor(Color.RED);view.setImageBitmap(bitmap);
            view.setZoom(10);assertEquals(4f,view.getZoom(),0f);view.setZoom(.1f);assertEquals(1f,view.getZoom(),0f);view.setZoom(2);
            MotionEvent down=MotionEvent.obtain(0,0,MotionEvent.ACTION_DOWN,150,150,0),move=MotionEvent.obtain(0,10,MotionEvent.ACTION_MOVE,250,150,0),up=MotionEvent.obtain(0,20,MotionEvent.ACTION_UP,250,150,0);
            try{assertTrue(view.onTouchEvent(down));assertTrue(view.onTouchEvent(move));assertTrue(view.onTouchEvent(up));}finally{down.recycle();move.recycle();up.recycle();}
            view.reset();assertEquals(1f,view.getZoom(),0f);view.setImageBitmap(null);
        });
    }
}
