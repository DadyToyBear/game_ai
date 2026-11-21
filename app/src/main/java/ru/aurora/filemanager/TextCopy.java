package ru.aurora.filemanager;

import android.net.Uri;
import java.io.IOException;

final class TextCopy {
    static void validateTarget(Uri source,Uri destination) throws IOException {
        if(source==null||destination==null||source.equals(destination))throw new IOException("Выберите новый файл, отличный от исходного");
    }
}
