#!/usr/bin/env bash
# Encode captured frames into the promo video (1440x1080, 60 fps) + the 800x600 CRT inputs.
# Run tools/record_frames.py first:  for c in race:24 play:16 diag:16; do python3 tools/record_frames.py ${c%%:*} frames/${c%%:*} ${c##*:} 60; done
set -euo pipefail
cd "$(dirname "$0")/.."; F=frames; O=video; mkdir -p $O $O/crt
FONT=${FONT:-$(fc-match -f '%{file}' 'DejaVu Sans:bold')}
enc() { ffmpeg -loglevel error -y -framerate 60 -i $F/$1/f%05d.png -vf "scale=1440:1080:flags=lanczos,setsar=1,drawbox=x=0:y=ih-66:w=iw:h=66:color=black@0.55:t=fill,drawtext=fontfile=$FONT:text='$2':fontcolor=white:fontsize=38:x=28:y=h-50" -c:v libx264 -pix_fmt yuv420p -crf 18 -r 60 $O/cap_$1.mp4
        ffmpeg -loglevel error -y -framerate 60 -i $F/$1/f%05d.png -vf "scale=1440:1080:flags=lanczos,setsar=1" -c:v libx264 -pix_fmt yuv420p -crf 18 -r 60 $O/clip_$1.mp4; }
enc race "Real wiring vs the same neurons, rewired at random"
enc play "The real C. elegans connectome playing Flappy Bird"
enc diag "Press D to see what drives every flap"
ffmpeg -loglevel error -y -i $O/cap_race.mp4 -i $O/cap_play.mp4 -i $O/cap_diag.mp4 -filter_complex "[0:v][1:v][2:v]concat=n=3:v=1[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -crf 18 -r 60 -movflags +faststart $O/flappyworm.mp4
for r in 60 30; do ffmpeg -loglevel error -y -i $O/flappyworm.mp4 -vf "fps=$r,scale=768:576:flags=lanczos,pad=800:600:16:12:black,format=yuv444p" -c:v libx264 -crf 12 $O/crt/flappyworm_800x600_${r}fps.mp4; done
echo "wrote $O/flappyworm.mp4, $O/clip_*.mp4, $O/crt/*.mp4"
