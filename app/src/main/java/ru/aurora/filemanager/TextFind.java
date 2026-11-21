package ru.aurora.filemanager;

/** Case-insensitive substring search with one wrap, using UTF-16 editor offsets. */
final class TextFind {
    /** One-based line number, with a final empty line after a trailing newline. */
    static int lineStart(CharSequence text,int line){
        if(text==null||line<1)return -1;
        if(line==1)return 0;
        int current=1;for(int i=0;i<text.length();i++)if(text.charAt(i)=='\n'&&++current==line)return i+1;
        return -1;
    }
    static int next(String text,String query,int from){
        if(text==null||query==null||query.isEmpty()||query.length()>256)return -1;
        int last=text.length()-query.length();if(last<0)return -1;int start=Math.max(0,Math.min(from,text.length()));
        for(int i=start;i<=last;i++)if(text.regionMatches(true,i,query,0,query.length()))return i;
        for(int i=0;i<start&&i<=last;i++)if(text.regionMatches(true,i,query,0,query.length()))return i;
        return -1;
    }
}
