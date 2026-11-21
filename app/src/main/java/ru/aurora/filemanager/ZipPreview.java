package ru.aurora.filemanager;

import android.os.CancellationSignal;
import java.io.*;
import java.util.*;
import java.util.zip.*;

/** Read-only, bounded listing. Entry data is drained to advance the streaming reader. */
final class ZipPreview {
    static final int MAX_ENTRIES=500;static final long MAX_BYTES=64L*1024*1024;
    static final class Item {final String name;final boolean directory,unsafe;final long bytes;Item(String name,boolean directory,boolean unsafe,long bytes){this.name=name;this.directory=directory;this.unsafe=unsafe;this.bytes=bytes;}}
    static final class Result {final List<Item> items=new ArrayList<>();long scanned;boolean limited;}
    static boolean unsafe(String name){if(name==null||name.isEmpty()||name.startsWith("/")||name.contains("\\")||name.indexOf('\0')>=0)return true;for(String part:name.split("/",-1))if(part.equals(".")||part.equals(".."))return true;return false;}
    static String displayName(String name){StringBuilder b=new StringBuilder();for(int i=0;i<name.length()&&i<500;i++){char c=name.charAt(i);b.append(Character.isISOControl(c)?'�':c);}if(name.length()>500)b.append("…");return b.toString();}
    static Result list(InputStream source,CancellationSignal cancel) throws IOException {
        PushbackInputStream input=ZipHeader.checked(source,cancel);Result result=new Result();
        try(ZipInputStream zip=new ZipInputStream(input)){
            byte[] buffer=new byte[32768];while(true){cancel.throwIfCanceled();ZipEntry entry=zip.getNextEntry();if(entry==null)break;
                if(result.items.size()>=MAX_ENTRIES){result.limited=true;break;}long size=0;
                while(true){cancel.throwIfCanceled();int allowed=(int)Math.min(buffer.length,MAX_BYTES-result.scanned);if(allowed==0){result.items.add(new Item(displayName(entry.getName()),entry.isDirectory(),unsafe(entry.getName()),size));result.limited=true;return result;}
                    int n=zip.read(buffer,0,allowed);if(n<0)break;if(n==0)throw new IOException("Чтение архива остановилось");result.scanned+=n;size+=n;
                }
                result.items.add(new Item(displayName(entry.getName()),entry.isDirectory(),unsafe(entry.getName()),size));
            }
        }return result;
    }
}
