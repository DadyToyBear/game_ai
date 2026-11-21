package ru.aurora.filemanager;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import java.io.IOException;
import java.io.InputStream;

/** Decode a bounded preview; never decode the full-resolution image just to show it. */
final class ImagePreview {
    private static final int MAX_SIDE=2048;
    static Bitmap load(ContentResolver resolver, Uri uri) throws IOException {
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
        try(InputStream input=open(resolver,uri)){BitmapFactory.decodeStream(input,null,bounds);}
        if(bounds.outWidth<=0||bounds.outHeight<=0)throw new IOException("Формат изображения не поддерживается");
        int sample=1;
        while((bounds.outWidth/sample>MAX_SIDE || bounds.outHeight/sample>MAX_SIDE) && sample<(1<<30))sample*=2;
        BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=sample;options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        Bitmap bitmap;
        try(InputStream input=open(resolver,uri)){bitmap=BitmapFactory.decodeStream(input,null,options);}
        if(bitmap==null)throw new IOException("Не удалось прочитать изображение");
        try {
            int orientation;
            try(InputStream input=open(resolver,uri)) {orientation=new ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);}
            Matrix transform=new Matrix();
            switch(orientation){
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: transform.setScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_180: transform.setRotate(180);break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: transform.setScale(1,-1);break;
                case ExifInterface.ORIENTATION_TRANSPOSE: transform.setRotate(90);transform.postScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_90: transform.setRotate(90);break;
                case ExifInterface.ORIENTATION_TRANSVERSE: transform.setRotate(-90);transform.postScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_270: transform.setRotate(-90);break;
                default: return bitmap;
            }
            Bitmap rotated=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),transform,true);
            if(rotated!=bitmap)bitmap.recycle();
            return rotated;
        } catch(IOException | RuntimeException ignored) {
            // Orientation metadata is optional: retain the successfully decoded image.
            return bitmap;
        }
    }
    private static InputStream open(ContentResolver resolver,Uri uri) throws IOException {
        InputStream input=resolver.openInputStream(uri);
        if(input==null)throw new IOException("Файл недоступен");return input;
    }
}
