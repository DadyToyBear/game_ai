package ru.aurora.filemanager;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.graphics.*;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;

/** Small, independent file manager based on Android's Storage Access Framework. */
public class MainActivity extends Activity {
    private static final int OPEN_TREE=1, SAVE_IMAGE=2;
    private LinearLayout root, body;
    private Uri tree, current;
    private final Stack<Uri> parents = new Stack<>();
    private PaintView canvas;
    private boolean fileScreen;
    private WebFilesServer webServer;
    private Entry clipboard; private boolean cut;
    private int dp(float n) { return (int)(n * getResources().getDisplayMetrics().density + .5f); }
    @Override public void onCreate(Bundle state) { super.onCreate(state); home(); }
    private TextView text(String s, int size) { TextView t=new TextView(this); t.setText(s); t.setTextSize(size); t.setTextColor(Color.rgb(28,38,55)); return t; }
    private Button button(String label, Runnable action) { Button b=new Button(this); b.setText(label); b.setAllCaps(false); b.setOnClickListener(v -> action.run()); return b; }
    private void layout(String title) {
        fileScreen="Файлы".equals(title);
        root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(18),dp(18),dp(18),dp(10)); root.setBackgroundColor(Color.rgb(247,249,252)); setContentView(root);
        TextView heading=text(title,26); heading.setTypeface(null,1); root.addView(heading);
        ScrollView scroll=new ScrollView(this); root.addView(scroll, new LinearLayout.LayoutParams(-1,0,1));
        body=new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(0,dp(16),0,0); scroll.addView(body);
    }
    private void note(String s) { TextView t=text(s,16); t.setPadding(0,dp(8),0,dp(8)); body.addView(t); }
    private void home() {
        layout("Aurora Files"); note("Файлы и инструменты · первая версия");
        body.addView(button("Открыть папку", () -> { Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE); i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION); startActivityForResult(i,OPEN_TREE); }));
        body.addView(button("SSH — выполнить команду", this::sshScreen));
        body.addView(button("Web-доступ к файлам", this::webScreen));
        body.addView(button("Paint — рисование", this::paintScreen));
        body.addView(button("Проверка сети · ping", this::pingScreen));
        body.addView(button("О приложении", () -> { layout("О приложении"); note("Независимый файловый менеджер. Для доступа к файлам выберите папку в системном диалоге Android.\n\nSSH и веб-доступ доступны в ограниченной первой версии. FTP, удалённый рабочий стол и видеоредактор пока не реализованы."); body.addView(button("Назад",this::home)); }));
    }
    @Override protected void onActivityResult(int req,int result,Intent data) {
        super.onActivityResult(req,result,data); if(result!=RESULT_OK || data==null || data.getData()==null) return;
        if(req==OPEN_TREE) { tree=data.getData(); clipboard=null; try { getContentResolver().takePersistableUriPermission(tree, data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION)); } catch(SecurityException ignored) {} current=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree)); parents.clear(); list(); }
        if(req==SAVE_IMAGE && canvas!=null) { try(OutputStream out=getContentResolver().openOutputStream(data.getData())) { if(out==null || !canvas.bitmap.compress(Bitmap.CompressFormat.PNG,100,out)) throw new IOException("Ошибка записи"); toast("Рисунок сохранён"); } catch(Exception e) { error(e); } }
    }
    private void list() {
        layout("Файлы"); body.addView(button("← Назад", () -> { if(parents.empty()) home(); else {current=parents.pop(); list();} }));
        if(clipboard!=null) body.addView(button((cut?"Вставить (переместить): ":"Вставить (копировать): ")+clipboard.name, this::paste));
        body.addView(button("＋ Новая папка", () -> input("Имя папки", name -> { try { if(DocumentsContract.createDocument(getContentResolver(),current,DocumentsContract.Document.MIME_TYPE_DIR,name)==null) throw new IOException("Создание не поддерживается"); list(); } catch(Exception e){error(e);} })));
        try {
            String id=DocumentsContract.getDocumentId(current); Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,id);
            ArrayList<Entry> entries=new ArrayList<>();
            try(Cursor c=getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null)) {
                if(c==null) throw new IOException("Папка недоступна");
                while(c.moveToNext()) entries.add(new Entry(DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0)),c.getString(1),c.getString(2),c.isNull(3)?-1:c.getLong(3)));
            }
            Collections.sort(entries,(a,b)-> { int x=Boolean.compare(b.dir(),a.dir()); return x!=0?x:a.name.compareToIgnoreCase(b.name); });
            if(entries.isEmpty()) note("Папка пуста");
            for(Entry e:entries) { TextView row=text((e.dir()?"📁  ":"📄  ")+e.name+(e.dir()||e.size<0?"":"  ·  "+android.text.format.Formatter.formatFileSize(this,e.size)),16); row.setPadding(dp(8),dp(16),dp(8),dp(16)); body.addView(row); row.setOnClickListener(v->{ if(e.dir()){parents.push(current);current=e.uri;list();} else open(e); }); row.setOnLongClickListener(v->{actions(e);return true;}); }
        } catch(Exception e) { error(e); }
    }
    private void open(Entry e) { if(isText(e)){editText(e);return;} try { Intent i=new Intent(Intent.ACTION_VIEW); i.setDataAndType(e.uri,mediaMime(e)); i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); startActivity(i); } catch(Exception ex){error(ex);} }
    private String mediaMime(Entry e) {
        if(!e.mime.equals("application/octet-stream"))return e.mime;
        String lower=e.name.toLowerCase(java.util.Locale.ROOT);int dot=lower.lastIndexOf('.');
        String mime=dot<0?null:android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(lower.substring(dot+1));
        return mime==null?e.mime:mime;
    }
    private boolean isText(Entry e) { String n=e.name.toLowerCase(java.util.Locale.ROOT); return e.mime.startsWith("text/") || n.endsWith(".txt") || n.endsWith(".md") || n.endsWith(".json") || n.endsWith(".xml") || n.endsWith(".csv") || n.endsWith(".log"); }
    private void actions(Entry e) {
        String[] choices={"Открыть", "Копировать", "Вырезать", "Сжать в ZIP", "Распаковать ZIP", "Переименовать", "Удалить", "Поделиться"};
        new AlertDialog.Builder(this).setTitle(e.name).setItems(choices,(d,n)->{
            if(n==0){if(e.dir()){parents.push(current);current=e.uri;list();}else open(e);}
            if(n==1||n==2){clipboard=e;cut=n==2;toast(cut?"Выбрано для перемещения":"Выбрано для копирования");list();}
            if(n==3) input("Имя ZIP-архива",name->{Uri dest=current;Uri selectedTree=tree;runFileTask(()->new FileOperations(getContentResolver(),selectedTree).zip(new FileOperations.Item(e.uri,e.name,e.mime),dest,name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")?name:name+".zip"),"Архив создан");});
            if(n==4){if(e.dir()||!e.name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")){toast("Выберите ZIP-файл");return;} input("Имя новой папки",name->{Uri dest=current;Uri selectedTree=tree;runFileTask(()->new FileOperations(getContentResolver(),selectedTree).unzip(new FileOperations.Item(e.uri,e.name,e.mime),dest,name),"Архив распакован");});}
            if(n==5) input("Новое имя",name->{try{if(DocumentsContract.renameDocument(getContentResolver(),e.uri,name)==null)throw new IOException("Переименование не поддерживается");list();}catch(Exception ex){error(ex);}});
            if(n==6) new AlertDialog.Builder(this).setMessage("Удалить «"+e.name+"»? Операция необратима.").setNegativeButton("Отмена",null).setPositiveButton("Удалить",(x,y)->{try{if(!DocumentsContract.deleteDocument(getContentResolver(),e.uri))throw new IOException("Удаление не поддерживается");list();}catch(Exception ex){error(ex);}}).show();
            if(n==7 && !e.dir()){Intent i=new Intent(Intent.ACTION_SEND);i.setType(e.mime);i.putExtra(Intent.EXTRA_STREAM,e.uri);i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(i,"Поделиться"));}
        }).show();
    }
    interface FileTask { void run() throws Exception; }
    private void runFileTask(FileTask task,String success) {
        toast("Операция выполняется…"); new Thread(()->{String message=success;try{task.run();}catch(Exception ex){message="Ошибка: "+ex.getMessage();}String answer=message;runOnUiThread(()->{if(!isFinishing()&&!isDestroyed()){toast(answer);if(fileScreen)list();}});},"file-operation").start();
    }
    private void paste() {
        Entry selected=clipboard; if(selected==null)return;
        if(selected.dir() && (selected.uri.equals(current)||parents.contains(selected.uri))){toast("Нельзя вставить папку внутрь самой себя");return;}
        Uri dest=current, selectedTree=tree; boolean move=cut; clipboard=null;
        runFileTask(()->{FileOperations ops=new FileOperations(getContentResolver(),selectedTree);ops.copy(new FileOperations.Item(selected.uri,selected.name,selected.mime),dest); if(move){try{if(!DocumentsContract.deleteDocument(getContentResolver(),selected.uri))throw new IOException("Удаление не поддерживается");}catch(Exception ex){throw new IOException("Копия создана, но исходный объект не удалён: "+ex.getMessage(),ex);}}},move?"Перемещение завершено":"Копирование завершено");
    }
    private void editText(Entry entry) {
        layout("Текст · "+entry.name); note("UTF-8, максимум 1 МиБ. Сохранение перезаписывает исходный файл; рекомендуется сделать копию.");
        EditText editor=new EditText(this);editor.setGravity(Gravity.TOP|Gravity.START);editor.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);editor.setMinLines(12);body.addView(editor);
        Button save=button("Сохранить",()->{});save.setEnabled(false);body.addView(save);body.addView(button("Назад",this::list));
        new Thread(()->{try(InputStream in=getContentResolver().openInputStream(entry.uri)){if(in==null)throw new IOException("Файл недоступен");ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>1048576)throw new IOException("Файл больше 1 МиБ");out.write(b,0,n);}String value=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString();runOnUiThread(()->{if(!isDestroyed()){editor.setText(value);save.setEnabled(true);}});}catch(Exception ex){runOnUiThread(()->error(ex));}},"text-read").start();
        save.setOnClickListener(v->{byte[] data=editor.getText().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);if(data.length>1048576){toast("Текст больше 1 МиБ");return;}save.setEnabled(false);new Thread(()->{String message;try(OutputStream out=getContentResolver().openOutputStream(entry.uri,"wt")){if(out==null)throw new IOException("Запись недоступна");out.write(data);message="Сохранено";}catch(Exception ex){message="Ошибка сохранения; файл мог быть изменён: "+ex.getMessage();}String answer=message;runOnUiThread(()->{if(!isDestroyed()){toast(answer);save.setEnabled(true);}});},"text-save").start();});
    }
    interface InputAction { void run(String value); }
    private void input(String title,InputAction action){ EditText edit=new EditText(this); new AlertDialog.Builder(this).setTitle(title).setView(edit).setNegativeButton("Отмена",null).setPositiveButton("ОК",(d,w)->{String value=edit.getText().toString().trim();if(!value.isEmpty())action.run(value);}).show(); }
    private EditText field(String hint, boolean secret) {
        EditText e=new EditText(this); e.setSingleLine(); e.setHint(hint);
        if(secret) e.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        body.addView(e); return e;
    }
    private void sshScreen() {
        layout("SSH · команда");
        note("Парольная авторизация, одна команда за соединение. Перед входом проверьте отпечаток ключа сервера.");
        EditText host=field("Адрес сервера",false), port=field("Порт (по умолчанию 22)",false), user=field("Пользователь",false), password=field("Пароль",true), command=field("Команда",false);
        TextView output=text("",14); Button run=button("Выполнить",()->{}); body.addView(run); body.addView(output);
        run.setOnClickListener(v->{
            String h=host.getText().toString().trim(), u=user.getText().toString().trim(), p=password.getText().toString(), cmd=command.getText().toString();
            int number; try { number=port.getText().toString().trim().isEmpty()?22:Integer.parseInt(port.getText().toString().trim()); if(number<1||number>65535||h.isEmpty()||u.isEmpty()||p.isEmpty()||cmd.trim().isEmpty()) throw new IllegalArgumentException(); }
            catch(Exception ex){toast("Заполните поля и укажите корректный порт");return;}
            run.setEnabled(false); output.setText("Подключение…");
            SshRunner.run(this,h,number,u,p,cmd,answer->{output.setText(answer);run.setEnabled(true);});
        });
        body.addView(button("Назад",this::home));
    }
    private void webScreen() {
        layout("Web-доступ");
        note("Браузер: только чтение. WebDAV (/dav/): чтение, запись включается отдельно. Это HTTP, не FTP. Пароль и файлы передаются без шифрования! Используйте только доверенную локальную сеть; не открывайте порт в интернет.");
        note(tree==null?"Сначала выберите папку на главном экране.":"Публикуется корень последней выбранной папки. Сервер работает, пока открыто приложение.");
        EditText port=field("Порт (по умолчанию 8080)",false), user=field("Имя пользователя",false), pass=field("Пароль",true);
        CheckBox anonymous=new CheckBox(this); anonymous.setText("Анонимный доступ (любой в сети)"); body.addView(anonymous);
        CheckBox writes=new CheckBox(this); writes.setText("Разрешить запись и удаление через WebDAV (только с паролем)"); body.addView(writes);
        TextView status=text(webServer==null?"Сервер остановлен":"Сервер запущен. Адреса: "+localAddresses(webServer.getListeningPort()),15); body.addView(status);
        body.addView(button("Запустить",()->{
            if(webServer!=null){toast("Сервер уже запущен");return;} if(tree==null){toast("Сначала выберите папку");return;}
            int number; String u=user.getText().toString().trim(), p=pass.getText().toString();
            try { number=port.getText().toString().trim().isEmpty()?8080:Integer.parseInt(port.getText().toString().trim()); if(number<1024||number>65535||(!anonymous.isChecked()&&(u.isEmpty()||u.contains(":")||p.isEmpty()))) throw new IllegalArgumentException(); }
            catch(Exception ex){toast("Укажите порт 1024–65535, имя без двоеточия и пароль, либо включите анонимный доступ");return;}
            boolean anon=anonymous.isChecked(), writable=writes.isChecked(); if(anon && writable){toast("Для записи отключите анонимный доступ и задайте логин и пароль");return;} Uri selected=tree;
            new AlertDialog.Builder(this).setTitle("Открыть доступ в сети?").setMessage(anon?"Любой пользователь сети сможет читать файлы выбранной папки. Соединение не шифруется.":(writable?"WebDAV сможет перезаписывать и удалять файлы. При сбое записи файл может повредиться. ":"")+"Пароль и файлы передаются без шифрования. Не используйте в недоверенной сети или интернете.")
              .setNegativeButton("Отмена",null).setPositiveButton("Запустить",(d,w)->{
                if(webServer!=null) return;
                try { WebFilesServer server=new WebFilesServer(getContentResolver(),selected,number,u,p,anon,writable,getCacheDir()); server.start(10000,false); webServer=server; status.setText("Сервер запущен: "+localAddresses(number)+"\nДля WebDAV добавьте /dav/ к адресу."); }
                catch(Exception ex){error(ex);}
              }).show();
        }));
        body.addView(button("Остановить",()->{stopWeb();status.setText("Сервер остановлен");}));
        body.addView(button("Назад",this::home));
    }
    private String localAddresses(int port) {
        ArrayList<String> result=new ArrayList<>();
        try { java.util.Enumeration<java.net.NetworkInterface> all=java.net.NetworkInterface.getNetworkInterfaces();
            while(all!=null && all.hasMoreElements()){java.net.NetworkInterface iface=all.nextElement(); if(!iface.isUp()||iface.isLoopback())continue; java.util.Enumeration<java.net.InetAddress> addresses=iface.getInetAddresses(); while(addresses.hasMoreElements()){java.net.InetAddress address=addresses.nextElement();if(address instanceof java.net.Inet4Address&&!address.isLoopbackAddress())result.add("http://"+address.getHostAddress()+":"+port+"/");}}
        } catch(Exception ignored) {} return result.isEmpty()?"IP-адрес не найден":android.text.TextUtils.join("\n",result);
    }
    private void stopWeb(){if(webServer!=null){webServer.stop();webServer=null;}}
    @Override protected void onDestroy(){stopWeb();super.onDestroy();}
    private void pingScreen(){ layout("Проверка сети"); note("ICMP ping: доступность зависит от сети и устройства."); EditText host=new EditText(this); host.setSingleLine(); host.setHint("Адрес или домен"); body.addView(host); TextView result=text("",15); body.addView(button("Проверить",()->{String h=host.getText().toString().trim(); if(!h.matches("[a-zA-Z0-9.:-]{1,253}") || h.startsWith("-")){result.setText("Некорректный адрес");return;} result.setText("Проверка…"); new Thread(()->{String output; try { Process p=new ProcessBuilder("ping","-c","1","-W","3",h).redirectErrorStream(true).start(); ByteArrayOutputStream b=new ByteArrayOutputStream(); try(InputStream in=p.getInputStream()){byte[] buf=new byte[1024];int n;while((n=in.read(buf))!=-1 && b.size()<8192)b.write(buf,0,n);} p.waitFor();output=b.toString("UTF-8"); }catch(Exception ex){output="Ошибка: "+ex.getMessage();} String finalOutput=output;runOnUiThread(()->result.setText(finalOutput));}).start();})); body.addView(result); body.addView(button("Назад",this::home)); }
    private void paintScreen(){ layout("Paint"); note("Рисуйте пальцем. Сохранение — в PNG."); canvas=new PaintView(this); body.addView(canvas,new LinearLayout.LayoutParams(-1,dp(360))); LinearLayout tools=new LinearLayout(this); body.addView(tools); tools.addView(button("Чёрный",()->canvas.color=Color.BLACK)); tools.addView(button("Красный",()->canvas.color=Color.RED)); tools.addView(button("Очистить",()->canvas.clear())); body.addView(button("Сохранить PNG",()->{Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("image/png");i.putExtra(Intent.EXTRA_TITLE,"drawing.png");startActivityForResult(i,SAVE_IMAGE);})); body.addView(button("Назад",this::home)); }
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();} private void error(Exception e){toast("Ошибка: "+e.getMessage());}
    @Override public void onBackPressed(){if(fileScreen && current!=null && !parents.empty()){current=parents.pop();list();}else{current=null;home();}}
    static class Entry { Uri uri; String name,mime; long size; Entry(Uri u,String n,String m,long s){uri=u;name=n==null?"Без имени":n;mime=m==null?"application/octet-stream":m;size=s;} boolean dir(){return DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);} }
    static class PaintView extends View { Bitmap bitmap=Bitmap.createBitmap(1200,1200,Bitmap.Config.ARGB_8888); Canvas drawing=new Canvas(bitmap); Paint brush=new Paint(3); int color=Color.BLACK; float px,py; PaintView(Context c){super(c);clear();} void clear(){drawing.drawColor(Color.WHITE);invalidate();} @Override protected void onDraw(Canvas c){super.onDraw(c);c.drawBitmap(bitmap,null,new Rect(0,0,getWidth(),getHeight()),null);} @Override public boolean onTouchEvent(android.view.MotionEvent e){float x=e.getX()*1200/getWidth(),y=e.getY()*1200/getHeight();if(e.getAction()==MotionEvent.ACTION_DOWN){px=x;py=y;return true;}if(e.getAction()==MotionEvent.ACTION_MOVE || e.getAction()==MotionEvent.ACTION_UP){brush.setColor(color);brush.setStrokeWidth(8);brush.setStrokeCap(Paint.Cap.ROUND);drawing.drawLine(px,py,x,y,brush);px=x;py=y;invalidate();return true;}return true;} }
}
