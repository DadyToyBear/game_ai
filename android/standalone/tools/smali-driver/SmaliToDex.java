import brut.androlib.src.SmaliBuilder;
import brut.directory.ExtFile;
import java.io.File;

public class SmaliToDex {
  public static void main(String[] a) throws Exception {
    // a[0] = папка smali, a[1] = выходной dex
    SmaliBuilder.build(new ExtFile(new File(a[0])), new File(a[1]), 21);
    System.out.println("dex собран: " + a[1]);
  }
}
