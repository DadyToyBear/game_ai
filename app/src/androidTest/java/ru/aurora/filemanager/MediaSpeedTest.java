package ru.aurora.filemanager;

import android.media.PlaybackParams;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class MediaSpeedTest {
    @Test public void speedChoicesHaveMatchingLabelsAndValidParams(){
        assertEquals(MediaSpeed.VALUES.length,MediaSpeed.LABELS.length);
        for(float speed:MediaSpeed.VALUES){PlaybackParams params=new PlaybackParams().setSpeed(speed);assertEquals(speed,params.getSpeed(),0.001f);}
        assertEquals(1f,MediaSpeed.VALUES[2],0f);
    }
}
