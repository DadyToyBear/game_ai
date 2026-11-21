package ru.aurora.filemanager;

import android.graphics.Bitmap;
import java.io.OutputStream;

final class PaintExport {
    static boolean compress(Bitmap image,OutputStream out,boolean jpeg){
        return image.compress(jpeg?Bitmap.CompressFormat.JPEG:Bitmap.CompressFormat.PNG,jpeg?90:100,out);
    }
}
