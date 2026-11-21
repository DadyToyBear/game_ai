package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TextFindTest {
    @Test public void lineOffsetsHandleEmptyAndTrailingLines(){
        assertEquals(0,TextFind.lineStart("",1));assertEquals(-1,TextFind.lineStart("",2));
        assertEquals(2,TextFind.lineStart("a\n\nб\n",2));assertEquals(3,TextFind.lineStart("a\n\nб\n",3));assertEquals(5,TextFind.lineStart("a\n\nб\n",4));
        assertEquals(-1,TextFind.lineStart("a",0));assertEquals(-1,TextFind.lineStart("a",2));assertEquals(-1,TextFind.lineStart(null,1));
    }
    @Test public void searchesFromCursorAndWrapsWithoutChangingOffsets(){
        String text="Тест one ТЕСТ";assertEquals(0,TextFind.next(text,"тест",0));assertEquals(9,TextFind.next(text,"тест",4));assertEquals(0,TextFind.next(text,"тест",13));
        assertEquals(-1,TextFind.next(text,"absent",0));assertEquals(-1,TextFind.next(text,"",0));assertEquals(5,TextFind.next(text,"ONE",0));
    }
}
