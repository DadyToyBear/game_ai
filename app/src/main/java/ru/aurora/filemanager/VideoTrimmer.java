package ru.aurora.filemanager;

import android.content.ContentResolver;
import android.content.res.AssetFileDescriptor;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import java.io.*;
import java.nio.ByteBuffer;

/** MP4 remux without re-encoding. Output is first written to private cache. */
final class VideoTrimmer {
    private static final long MAX_SOURCE=512L*1024*1024;
    private static final int MAX_SAMPLE=16*1024*1024;
    static final class Result {final long actualStartUs;final int frames;Result(long start,int frames){actualStartUs=start;this.frames=frames;}}
    static Result trim(ContentResolver resolver,Uri source,Uri target,File cache,long startMs,long endMs,CancellationSignal cancel) throws Exception {
        if(source.equals(target))throw new IOException("Выберите другой файл для сохранения");
        if(startMs<0||endMs<=startMs||endMs>Long.MAX_VALUE/1000)throw new IOException("Некорректный диапазон");
        long startUs=startMs*1000,endUs=endMs*1000;
        File temporary=null;
        try(AssetFileDescriptor afd=resolver.openAssetFileDescriptor(source,"r",cancel)) {
            if(afd==null)throw new IOException("Исходный файл недоступен");
            long sourceSize=afd.getLength();if(sourceSize<0)sourceSize=afd.getParcelFileDescriptor().getStatSize();
            if(sourceSize<0||sourceSize>MAX_SOURCE)throw new IOException("Размер файла неизвестен или превышает 512 МиБ");
            if(cache.getUsableSpace()<sourceSize+16L*1024*1024)throw new IOException("Недостаточно места в кэше");
            cancel.throwIfCanceled();
            MediaExtractor probe=new MediaExtractor();long anchor;int videoTrack=-1,audioTrack=-1;MediaFormat videoFormat=null,audioFormat=null;
            try {
                setSource(probe,afd);
                for(int i=0;i<probe.getTrackCount();i++){
                    MediaFormat fmt=probe.getTrackFormat(i);String mime=fmt.getString(MediaFormat.KEY_MIME);if(mime==null)continue;
                    if(mime.startsWith("video/")){if(videoTrack!=-1)throw new IOException("Несколько видеодорожек не поддерживаются");if(!mime.equals("video/avc")&&!mime.equals("video/hevc"))throw new IOException("Поддерживаются только H.264 и H.265");videoTrack=i;videoFormat=fmt;}
                    else if(mime.startsWith("audio/")){if(audioTrack!=-1)throw new IOException("Несколько аудиодорожек не поддерживаются");if(!mime.equals("audio/mp4a-latm"))throw new IOException("Поддерживается только звук AAC");audioTrack=i;audioFormat=fmt;}
                }
                if(videoTrack<0)throw new IOException("Видеодорожка не найдена");
                if(videoFormat.containsKey(MediaFormat.KEY_DURATION) && startUs>=videoFormat.getLong(MediaFormat.KEY_DURATION))throw new IOException("Начало находится за пределами видео");
                probe.selectTrack(videoTrack);probe.seekTo(startUs,MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                anchor=probe.getSampleTime();
                if(anchor<0||anchor>=endUs||(probe.getSampleFlags()&MediaExtractor.SAMPLE_FLAG_SYNC)==0)throw new IOException("Не удалось найти ключевой кадр перед концом фрагмента");
            }finally{probe.release();}
            cancel.throwIfCanceled();temporary=File.createTempFile("aurora-video-", ".mp4",cache);
            MediaExtractor extractor=new MediaExtractor();MediaMuxer muxer=null;boolean started=false;int frames=0;
            try {
                setSource(extractor,afd);extractor.selectTrack(videoTrack);if(audioTrack>=0)extractor.selectTrack(audioTrack);
                extractor.seekTo(anchor,MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                muxer=new MediaMuxer(temporary.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
                if(videoFormat.containsKey("rotation-degrees")){int angle=videoFormat.getInteger("rotation-degrees");if(angle==0||angle==90||angle==180||angle==270)muxer.setOrientationHint(angle);}
                int videoOut=muxer.addTrack(videoFormat),audioOut=audioTrack>=0?muxer.addTrack(audioFormat):-1;
                muxer.start();started=true;ByteBuffer buffer=ByteBuffer.allocateDirect(MAX_SAMPLE);MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
                long lastVideo=-1,lastAudio=-1;
                while(true){
                    cancel.throwIfCanceled();int track=extractor.getSampleTrackIndex();long time=extractor.getSampleTime();if(track<0||time<0)break;
                    if(time>=endUs){extractor.advance();continue;}
                    if(time<anchor){extractor.advance();continue;}
                    int flags=extractor.getSampleFlags();if((flags&MediaExtractor.SAMPLE_FLAG_ENCRYPTED)!=0)throw new IOException("Защищённое видео не поддерживается");
                    if((flags&MediaExtractor.SAMPLE_FLAG_PARTIAL_FRAME)!=0)throw new IOException("Частичные кадры не поддерживаются");
                    if(Build.VERSION.SDK_INT>=28 && extractor.getSampleSize()>MAX_SAMPLE)throw new IOException("Кадр больше 16 МиБ");
                    buffer.clear();int n=extractor.readSampleData(buffer,0);if(n<0)break;if(n>MAX_SAMPLE)throw new IOException("Кадр больше 16 МиБ");
                    long pts=time-anchor;
                    if(track==videoTrack){if(frames==0&&(time!=anchor||(flags&MediaExtractor.SAMPLE_FLAG_SYNC)==0))throw new IOException("Не удалось сохранить выбранный ключевой кадр");if(pts<lastVideo)throw new IOException("Порядок кадров не поддерживается без перекодирования");lastVideo=pts;frames++;}
                    else if(track==audioTrack){if(pts<lastAudio)throw new IOException("Порядок аудиоданных не поддерживается");lastAudio=pts;}
                    else {extractor.advance();continue;}
                    info.set(0,n,pts,(flags&MediaExtractor.SAMPLE_FLAG_SYNC)!=0?MediaCodec.BUFFER_FLAG_KEY_FRAME:0);
                    muxer.writeSampleData(track==videoTrack?videoOut:audioOut,buffer,info);extractor.advance();
                }
                if(frames==0)throw new IOException("В выбранном диапазоне нет видео");
                cancel.throwIfCanceled();muxer.stop();started=false;
            }finally {
                extractor.release();
                if(muxer!=null){if(started)try{muxer.stop();}catch(Exception ignored){}muxer.release();}
            }
            cancel.throwIfCanceled();
            try(InputStream in=new FileInputStream(temporary);OutputStream out=resolver.openOutputStream(target,"wt")){
                if(out==null)throw new IOException("Выходной файл недоступен");byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1){cancel.throwIfCanceled();out.write(buffer,0,n);}
            }
            return new Result(anchor,frames);
        }finally{if(temporary!=null)temporary.delete();}
    }
    private static void setSource(MediaExtractor extractor,AssetFileDescriptor afd) throws IOException {
        long length=afd.getLength();if(length>=0)extractor.setDataSource(afd.getFileDescriptor(),afd.getStartOffset(),length);
        else if(afd.getStartOffset()==0)extractor.setDataSource(afd.getFileDescriptor());
        else throw new IOException("Провайдер не сообщил длину файла");
    }
}
