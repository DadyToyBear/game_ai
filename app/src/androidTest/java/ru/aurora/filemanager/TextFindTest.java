package ru.aurora.filemanager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TextFindTest {
    @Test public void searchesFromCursorAndWrapsWithoutChangingOffsets(){
        String text="Тест one ТЕСТ";assertEquals(0,TextFind.next(text,"тест",0));assertEquals(9,TextFind.next(text,"тест",4));assertEquals(0,TextFind.next(text,"тест",13));
        assertEquals(-1,TextFind.next(text,"absent",0));assertEquals(-1,TextFind.next(text,"",0));assertEquals(5,TextFind.next(text,"ONE",0));
    }
}
