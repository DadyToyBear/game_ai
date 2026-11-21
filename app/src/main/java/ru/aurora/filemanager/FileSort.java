package ru.aurora.filemanager;

import java.util.Comparator;

/** Sort within a folder; directories precede files and unknown sizes go last. */
final class FileSort {
    enum Mode { NAME_ASC, NAME_DESC, SIZE_DESC, SIZE_ASC }
    static Comparator<MainActivity.Entry> comparator(Mode mode){return (a,b)->{
        int folders=Boolean.compare(b.dir(),a.dir());if(folders!=0)return folders;
        if(!a.dir()&&(mode==Mode.SIZE_ASC||mode==Mode.SIZE_DESC)){
            if((a.size<0)!=(b.size<0))return a.size<0?1:-1;
            if(a.size>=0){int size=mode==Mode.SIZE_ASC?Long.compare(a.size,b.size):Long.compare(b.size,a.size);if(size!=0)return size;}
        }
        int name=a.name.compareToIgnoreCase(b.name);if(name==0)name=a.name.compareTo(b.name);
        return mode==Mode.NAME_DESC?-name:name;
    };}
}
