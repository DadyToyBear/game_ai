package ru.aurora.filemanager;

import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class BookmarkStoreTest {
    @Test public void savesAndDeletesFolderReferencesWithoutFileOperations() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String prefs="test_bookmarks_"+UUID.randomUUID();BookmarkStore store=new BookmarkStore(context,prefs);
        Uri tree=Uri.parse("content://example.provider/tree/root"),folder=DocumentsContract.buildDocumentUriUsingTree(tree,"folder:one");
        try{
            assertTrue(BookmarkStore.validPair(tree,folder));assertFalse(BookmarkStore.validPair(tree,Uri.parse("content://other/tree/root/document/folder")));
            store.add("Работа",tree,folder);List<BookmarkStore.Bookmark> entries=new BookmarkStore(context,prefs).list();assertEquals(1,entries.size());assertEquals("Работа",entries.get(0).name);assertEquals(tree,entries.get(0).tree);assertEquals(folder,entries.get(0).document);
            store.remove(entries.get(0).id);assertTrue(store.list().isEmpty());
            try{store.add(" ",tree,folder);fail("empty name");}catch(java.io.IOException expected){}
            try{store.add("bad",tree,Uri.parse("file:///tmp/test"));fail("invalid URI");}catch(java.io.IOException expected){}
        }finally{context.getSharedPreferences(prefs,Context.MODE_PRIVATE).edit().clear().commit();}
    }
}
