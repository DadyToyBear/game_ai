package ru.aurora.filemanager;

import android.os.CancellationSignal;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Streaming checksum; does not alter its input and never loads the full file. */
final class FileDigest {
    static final class Result {final String sha256;final long bytes;Result(String sha256,long bytes){this.sha256=sha256;this.bytes=bytes;}}
    static Result sha256(InputStream input,CancellationSignal cancel) throws IOException {
        MessageDigest digest;try{digest=MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException ex){throw new IOException("SHA-256 недоступен",ex);}
        byte[] buffer=new byte[32768];long total=0;
        while(true){cancel.throwIfCanceled();int n=input.read(buffer);if(n<0)break;if(n==0)throw new IOException("Провайдер остановил чтение");if(total>Long.MAX_VALUE-n)throw new IOException("Файл слишком большой");total+=n;digest.update(buffer,0,n);}
        cancel.throwIfCanceled();byte[] hash=digest.digest();char[] hex="0123456789abcdef".toCharArray();StringBuilder result=new StringBuilder(64);
        for(byte b:hash){result.append(hex[(b&255)>>>4]).append(hex[b&15]);}return new Result(result.toString(),total);
    }
}
