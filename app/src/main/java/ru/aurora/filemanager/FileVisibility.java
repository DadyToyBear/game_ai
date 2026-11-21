package ru.aurora.filemanager;

/** Dot-prefixed names are a display convention, not an access-control boundary. */
final class FileVisibility {
    static boolean show(String name,boolean showHidden){return showHidden||name==null||!name.startsWith(".");}
}
