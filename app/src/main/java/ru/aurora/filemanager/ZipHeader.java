package ru.aurora.filemanager;

import android.os.CancellationSignal;
import java.io.*;

/** Check the streaming ZIP signature without consuming bytes from the caller's stream. */
final class ZipHeader {
    static PushbackInputStream checked(InputStream source,CancellationSignal cancel) throws IOException {
        PushbackInputStream input=new PushbackInputStream(source,4);byte[] magic=new byte[4];int got=0;
        while(got<4){if(cancel!=null)cancel.throwIfCanceled();int n=input.read(magic,got,4-got);if(n<0)break;if(n==0)throw new IOException("Чтение архива остановилось");got+=n;}
        if(got<4||magic[0]!='P'||magic[1]!='K'||!((magic[2]==3&&magic[3]==4)||(magic[2]==5&&magic[3]==6)))throw new IOException("Файл не похож на поддерживаемый ZIP");
        input.unread(magic);return input;
    }
}
