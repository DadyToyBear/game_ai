package ru.aurora.filemanager;

import android.media.MediaFormat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.IOException;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class VideoTrimmerTest {
    @Test public void muteOmitsUnsupportedAndMultipleAudioTracks() throws Exception {
        MediaFormat video=MediaFormat.createVideoFormat("video/avc",320,240);
        MediaFormat aac=MediaFormat.createAudioFormat("audio/mp4a-latm",44100,2);
        MediaFormat unsupported=MediaFormat.createAudioFormat("audio/mpeg",44100,2);
        VideoTrimmer.Tracks normal=VideoTrimmer.selectTracks(Arrays.asList(video,aac),false);assertEquals(0,normal.video);assertEquals(1,normal.audio);
        VideoTrimmer.Tracks muted=VideoTrimmer.selectTracks(Arrays.asList(video,aac,unsupported),true);assertEquals(0,muted.video);assertEquals(-1,muted.audio);
        try{VideoTrimmer.selectTracks(Arrays.asList(video,unsupported),false);fail("unsupported audio");}catch(IOException expected){}
        try{VideoTrimmer.selectTracks(Arrays.asList(video,aac,aac),false);fail("multiple audio");}catch(IOException expected){}
        try{VideoTrimmer.selectTracks(Arrays.asList(aac),true);fail("missing video");}catch(IOException expected){}
    }
}
