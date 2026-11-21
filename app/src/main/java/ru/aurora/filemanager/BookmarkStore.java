package ru.aurora.filemanager;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.IOException;
import java.util.*;
import org.json.*;

/** Folder references only; permission is checked separately when opening. */
final class BookmarkStore {
    private static final Object LOCK=new Object();private final SharedPreferences prefs;
    static final class Bookmark {final String id,name;final Uri tree,document;Bookmark(String id,String name,Uri tree,Uri document){this.id=id;this.name=name;this.tree=tree;this.document=document;}}
    BookmarkStore(Context context){this(context,"folder_bookmarks");}
    BookmarkStore(Context context,String name){prefs=context.getApplicationContext().getSharedPreferences(name,Context.MODE_PRIVATE);}
    static boolean validPair(Uri tree,Uri document){
        try{return tree!=null&&document!=null&&"content".equals(tree.getScheme())&&DocumentsContract.isTreeUri(tree)&&tree.getAuthority().equals(document.getAuthority())&&DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getDocumentId(document)).equals(document);}
        catch(Exception ex){return false;}
    }
    List<Bookmark> list() throws Exception {synchronized(LOCK){JSONArray arr=new JSONArray(prefs.getString("items","[]"));List<Bookmark> result=new ArrayList<>();
        for(int i=0;i<arr.length();i++){JSONObject obj=arr.getJSONObject(i);Uri tree=Uri.parse(obj.getString("tree")),document=Uri.parse(obj.getString("document"));if(!validPair(tree,document))throw new IOException("Повреждён список закладок");result.add(new Bookmark(obj.getString("id"),obj.getString("name"),tree,document));}return result;}}
    void add(String name,Uri tree,Uri document) throws Exception {name=name==null?"":name.trim();if(name.isEmpty()||name.length()>80)throw new IOException("Название должно содержать от 1 до 80 символов");if(!validPair(tree,document))throw new IOException("Недопустимая ссылка на папку");
        synchronized(LOCK){JSONArray arr=new JSONArray(prefs.getString("items","[]"));if(arr.length()>=30)throw new IOException("Максимум 30 закладок");
            arr.put(new JSONObject().put("id",UUID.randomUUID().toString()).put("name",name).put("tree",tree.toString()).put("document",document.toString()));
            if(!prefs.edit().putString("items",arr.toString()).commit())throw new IOException("Не удалось сохранить закладку");}}
    void remove(String id) throws Exception {synchronized(LOCK){JSONArray arr=new JSONArray(prefs.getString("items","[]")),next=new JSONArray();boolean found=false;
        for(int i=0;i<arr.length();i++){JSONObject obj=arr.getJSONObject(i);if(obj.getString("id").equals(id))found=true;else next.put(obj);}if(!found)throw new IOException("Закладка не найдена");
        if(!prefs.edit().putString("items",next.toString()).commit())throw new IOException("Не удалось удалить закладку");}}
}
