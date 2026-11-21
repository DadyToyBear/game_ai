package ru.aurora.filemanager;

/** Case-insensitive substring search with one wrap, using UTF-16 editor offsets. */
final class TextFind {
    static int next(String text,String query,int from){
        if(text==null||query==null||query.isEmpty()||query.length()>256)return -1;
        int last=text.length()-query.length();if(last<0)return -1;int start=Math.max(0,Math.min(from,text.length()));
        for(int i=start;i<=last;i++)if(text.regionMatches(true,i,query,0,query.length()))return i;
        for(int i=0;i<start&&i<=last;i++)if(text.regionMatches(true,i,query,0,query.length()))return i;
        return -1;
    }
}
