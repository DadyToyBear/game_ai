package ru.aurora.filemanager;

import android.graphics.Bitmap;

/** In-place filters for a mutable snapshot, not the live canvas. */
final class PaintFilters {
    static int filterPixel(int color,boolean grayscale){
        int a=color&0xff000000,r=(color>>>16)&255,g=(color>>>8)&255,b=color&255;
        if(grayscale){int gray=(299*r+587*g+114*b+500)/1000;return a|(gray<<16)|(gray<<8)|gray;}
        return a|((255-r)<<16)|((255-g)<<8)|(255-b);
    }
    static void apply(Bitmap image,boolean grayscale){
        int w=image.getWidth(),h=image.getHeight();int[] row=new int[w];
        for(int y=0;y<h;y++){image.getPixels(row,0,w,0,y,w,1);for(int x=0;x<w;x++)row[x]=filterPixel(row[x],grayscale);image.setPixels(row,0,w,0,y,w,1);}
    }
}
