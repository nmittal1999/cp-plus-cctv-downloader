package rtsp

import (
    "bufio"
    "net"
    "net/url"
    "testing"
    "github.com/AlexxIT/go2rtc/pkg/tcp"
)

func TestPlaybackScaleOnWire(t *testing.T) {
    for _, scale := range []string{"", "0.5", "2", "4"} {
        client, server := net.Pipe()
        uri, _ := url.Parse("rtsp://recorder/cam/playback?channel=1")
        c := &Conn{URL: uri, Scale: scale, conn: client, auth: tcp.NewAuth(nil)}
        done := make(chan error, 1)
        go func(){ done <- c.Play() }()
        request, err := tcp.ReadRequest(bufio.NewReader(server))
        if err != nil { t.Fatal(err) }
        if request.Method != "PLAY" || request.Header.Get("Scale") != scale {
            t.Fatalf("unexpected playback request: %s %v", request.Method, request.Header)
        }
        if err := <-done; err != nil { t.Fatal(err) }
        client.Close(); server.Close()
    }
}
