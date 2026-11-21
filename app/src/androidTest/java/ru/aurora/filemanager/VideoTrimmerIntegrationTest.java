package ru.aurora.filemanager;

import android.content.Context;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.CancellationSignal;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Remuxes a generated, tiny AVC/AAC MP4 fixture, without external storage permissions. */
@RunWith(AndroidJUnit4.class)
public class VideoTrimmerIntegrationTest {
    @Test public void trimsRealMp4WithAndWithoutAudio() throws Exception {
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext(),tests=InstrumentationRegistry.getInstrumentation().getContext();
        File source=File.createTempFile("video-source-",".mp4",target.getCacheDir()),audio=File.createTempFile("video-audio-",".mp4",target.getCacheDir()),muted=File.createTempFile("video-muted-",".mp4",target.getCacheDir());
        try{
            try(InputStream in=tests.getAssets().open("video-fixture.mp4");OutputStream out=new FileOutputStream(source)){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
            Uri sourceUri=Uri.fromFile(source);VideoTrimmer.Result withAudio=VideoTrimmer.trim(target.getContentResolver(),sourceUri,Uri.fromFile(audio),target.getCacheDir(),400,1500,false,new CancellationSignal());
            VideoTrimmer.Result withoutAudio=VideoTrimmer.trim(target.getContentResolver(),sourceUri,Uri.fromFile(muted),target.getCacheDir(),400,1500,true,new CancellationSignal());
            assertTrue(withAudio.frames>0);assertTrue(withoutAudio.frames>0);assertTrue(withAudio.actualStartUs<=400000);assertEquals(withAudio.actualStartUs,withoutAudio.actualStartUs);
            assertTracks(audio,true);assertTracks(muted,false);
        }finally{source.delete();audio.delete();muted.delete();}
    }
    private void assertTracks(File file,boolean expectAudio) throws Exception {
        MediaExtractor extractor=new MediaExtractor();boolean video=false,audio=false;
        try{extractor.setDataSource(file.getAbsolutePath());for(int i=0;i<extractor.getTrackCount();i++){MediaFormat format=extractor.getTrackFormat(i);String mime=format.getString(MediaFormat.KEY_MIME);if(mime!=null&&mime.startsWith("video/"))video=true;if(mime!=null&&mime.startsWith("audio/"))audio=true;}assertTrue(video);assertEquals(expectAudio,audio);}finally{extractor.release();}
    }
}
