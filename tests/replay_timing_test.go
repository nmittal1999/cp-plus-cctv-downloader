package mp4
import("testing"; "github.com/AlexxIT/go2rtc/pkg/core"; "github.com/pion/rtp")
func TestRecordedFrameGap(t *testing.T){
 m:=&Muxer{};m.AddTrack(&core.Codec{Name:core.CodecH265,ClockRate:90000});m.pts[0]=90000
 m.GetPayload(0,&rtp.Packet{Header:rtp.Header{Timestamp:270000},Payload:[]byte{0,0,0,2,0x26,1}})
 if m.dts[0]!=180000{t.Fatalf("2s replay gap collapsed to %d ticks",m.dts[0])}
 m.GetPayload(0,&rtp.Packet{Header:rtp.Header{Timestamp:270000},Payload:[]byte{0,0,0,2,0x26,1}})
 if m.dts[0]!=180091{t.Fatal("zero-duration protection lost")}
}
