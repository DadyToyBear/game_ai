package ru.aurora.filemanager;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import java.io.IOException;

final class VideoInfo {
    static long parseDuration(String value) throws IOException {
        try{long duration=Long.parseLong(value);if(duration<=0||duration>Long.MAX_VALUE/1000)throw new NumberFormatException();return duration;}
        catch(Exception ex){throw new IOException("Длительность видео недоступна");}
    }
    static long duration(Context context,Uri uri) throws IOException {
        MediaMetadataRetriever retriever=new MediaMetadataRetriever();
        try{retriever.setDataSource(context,uri);return parseDuration(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));}
        catch(IOException ex){throw ex;}catch(Exception ex){throw new IOException("Не удалось прочитать длительность видео",ex);}
        finally{retriever.release();}
    }
}
