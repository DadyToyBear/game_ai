package ru.aurora.filemanager;

import android.content.Context;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class VncViewTest {
    @Test public void zoomPanAndPointerMapping(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();FrameLayout parent=new FrameLayout(context);MainActivity.VncView view=new MainActivity.VncView(context);parent.addView(view);view.layout(0,0,200,200);
            view.client=new VncClient(new VncClient.Listener(){public void connected(int w,int h,String n){}public void frame(int w,int h,int[] p){}public void finished(String why){}});view.updateFrame(100,100,new int[10000]);view.setZoom(8);assertEquals(4f,view.zoom,0f);view.setZoom(2);
            view.setPanMode(true);MotionEvent down=MotionEvent.obtain(0,0,MotionEvent.ACTION_DOWN,100,100,0),move=MotionEvent.obtain(0,10,MotionEvent.ACTION_MOVE,150,100,0),up=MotionEvent.obtain(0,20,MotionEvent.ACTION_UP,150,100,0);
            try{assertTrue(view.onTouchEvent(down));assertTrue(view.onTouchEvent(move));assertTrue(view.onTouchEvent(up));assertEquals(50f,view.panX,0.01f);}finally{down.recycle();move.recycle();up.recycle();}
            view.setPanMode(false);MotionEvent click=MotionEvent.obtain(0,30,MotionEvent.ACTION_DOWN,100,100,0),release=MotionEvent.obtain(0,40,MotionEvent.ACTION_UP,100,100,0);
            try{assertTrue(view.onTouchEvent(click));assertEquals(37,view.lastX);assertEquals(50,view.lastY);assertTrue(view.onTouchEvent(release));}finally{click.recycle();release.recycle();view.client.stop();view.clear();}
        });
    }
}
