package ru.aurora.filemanager;

import android.content.Context;
import android.graphics.*;
import android.view.*;

/** Centered fit with bounded zoom and one-finger panning of the sampled preview. */
final class ZoomImageView extends View {
    private Bitmap image;private float zoom=1,panX,panY,lastX,lastY;private boolean dragging;
    ZoomImageView(Context context){super(context);setBackgroundColor(Color.DKGRAY);}
    void setImageBitmap(Bitmap next){if(image!=null&&image!=next)image.recycle();image=next;zoom=1;panX=panY=0;invalidate();}
    float getZoom(){return zoom;}
    void setZoom(float value){if(Float.isNaN(value)||Float.isInfinite(value))return;zoom=Math.max(1,Math.min(4,value));clamp();invalidate();}
    void reset(){zoom=1;panX=panY=0;invalidate();}
    private float scale(){return image==null||getWidth()==0||getHeight()==0?0:Math.min((float)getWidth()/image.getWidth(),(float)getHeight()/image.getHeight())*zoom;}
    private void clamp(){if(image==null)return;float scale=scale();float maxX=Math.max(0,(image.getWidth()*scale-getWidth())/2f),maxY=Math.max(0,(image.getHeight()*scale-getHeight())/2f);panX=Math.max(-maxX,Math.min(maxX,panX));panY=Math.max(-maxY,Math.min(maxY,panY));}
    @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){super.onSizeChanged(w,h,oldw,oldh);clamp();}
    @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);if(image==null)return;float s=scale(),w=image.getWidth()*s,h=image.getHeight()*s;canvas.drawBitmap(image,null,new RectF((getWidth()-w)/2+panX,(getHeight()-h)/2+panY,(getWidth()+w)/2+panX,(getHeight()+h)/2+panY),null);}
    @Override public boolean onTouchEvent(MotionEvent event){if(image==null||zoom<=1)return false;
        switch(event.getActionMasked()){
            case MotionEvent.ACTION_DOWN:dragging=true;lastX=event.getX();lastY=event.getY();if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(true);return true;
            case MotionEvent.ACTION_MOVE:if(!dragging)return false;panX+=event.getX()-lastX;panY+=event.getY()-lastY;lastX=event.getX();lastY=event.getY();clamp();invalidate();return true;
            case MotionEvent.ACTION_UP:case MotionEvent.ACTION_CANCEL:if(!dragging)return false;dragging=false;if(getParent()!=null)getParent().requestDisallowInterceptTouchEvent(false);if(event.getActionMasked()==MotionEvent.ACTION_UP)performClick();return true;
            default:return dragging;
        }
    }
    @Override public boolean performClick(){super.performClick();return true;}
    @Override protected void onDetachedFromWindow(){super.onDetachedFromWindow();if(image!=null){image.recycle();image=null;}}
}
