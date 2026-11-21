package ru.aurora.filemanager;

import android.graphics.Color;

final class PaintColors {
    static int parse(String value){
        if(value==null)throw new IllegalArgumentException("Введите цвет в формате RRGGBB");
        String text=value.trim();if(text.startsWith("#"))text=text.substring(1);
        if(!text.matches("[0-9a-fA-F]{6}"))throw new IllegalArgumentException("Введите шесть шестнадцатеричных цифр: RRGGBB");
        return Color.rgb(Integer.parseInt(text.substring(0,2),16),Integer.parseInt(text.substring(2,4),16),Integer.parseInt(text.substring(4,6),16));
    }
}
