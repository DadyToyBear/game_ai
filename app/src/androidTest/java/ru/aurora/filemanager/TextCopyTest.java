package ru.aurora.filemanager;

import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.IOException;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TextCopyTest {
    @Test public void refusesSameOrMissingUri() throws Exception {
        Uri source=Uri.parse("content://example/document/a"),other=Uri.parse("content://example/document/b");TextCopy.validateTarget(source,other);
        try{TextCopy.validateTarget(source,source);fail("same source");}catch(IOException expected){}
        try{TextCopy.validateTarget(source,null);fail("missing target");}catch(IOException expected){}
    }
}
