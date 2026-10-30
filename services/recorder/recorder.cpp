#include "LiveRoom.h"
#include <atomic>
#include <chrono>
#include <csignal>
#include <deque>
#include <iostream>
#include <mutex>
#include <poll.h>
#include <string>
#include <unistd.h>

// One isolated SDK process per session. Tokens arrive over stdin, never process arguments.
using namespace ZEGO::LIVEROOM;
struct Event { std::string type; int code; };
std::mutex eventsMutex, outputMutex;
std::deque<Event> events;
volatile std::sig_atomic_t interrupted = 0;
void signalStop(int) { interrupted = 1; }
void emit(const std::string& type, int code = 0) {
  std::lock_guard<std::mutex> lock(outputMutex);
  std::cout << "{\"event\":\"" << type << "\",\"code\":" << code << "}" << std::endl;
}
void enqueue(const std::string& type, int code = 0) {
  std::lock_guard<std::mutex> lock(eventsMutex); events.push_back({type, code});
}
class Recorder final : public ICallback {
public:
  std::string stream;
  void OnInitSDK(int code) override { enqueue("init", code); }
  void OnLoginRoom(int code, const char*) override { enqueue("login", code); }
  void OnDisconnect(int code, const char*) override { enqueue("disconnect", code); }
  void OnStreamUpdate(ZegoStreamUpdateType type, ZegoStreamInfo* rows, unsigned int count, const char*) override {
    for (unsigned int i=0;i<count;i++) if (stream==rows[i].szStreamId && type==StreamAdded) enqueue("stream");
  }
  void OnStreamRecordBegin(const char*, const char*) override { emit("recording"); }
  void OnStreamRecordEnd(const char*, const char*, RecordEndReason reason) override { enqueue("ended", int(reason)); }
  void OnMixStreamRecordUpdate(const char**, int) override {}
  void OnTokenWillExpired(const char*, int) override { emit("token"); }
  void OnStreamRecordEvent(const char*, RecordEvent event) override { emit(event==RecordEventPause?"interrupted":"resumed"); }
};
int main(int argc, char** argv) {
  if (argc==2 && std::string(argv[1])=="--version") { std::cout << GetSDKVersion() << std::endl; return 0; }
  if (argc!=6) return 2;
  std::signal(SIGTERM,signalStop); std::signal(SIGINT,signalStop);
  const std::string room=argv[2], user=argv[3], directory=argv[5];
  std::string token;
  if (!std::getline(std::cin,token) || token.size()>8192) return 2;
  Recorder callback; callback.stream=argv[4];
  SetCallback(&callback); SetConfig("play_loop_retry=true"); SetConfig("max_channels=1");
  SetMuxerOutType(MuxerOutTypeOnlyWriteFile); SetLogDirAndSize((directory+"/sdk").c_str(),1024*1024);
  if (!InitSDK(static_cast<unsigned int>(std::stoul(argv[1])))) return 3;
  bool recording=false, stopping=false, finished=false, loggedIn=false;
  unsigned int part=0; int exitCode=0;
  const auto started=std::chrono::steady_clock::now(); auto stopTime=started, nextRecordAttempt=started;
  std::string input;
  while (!finished) {
    std::deque<Event> pending;
    { std::lock_guard<std::mutex> lock(eventsMutex); pending.swap(events); }
    for (const auto& e:pending) {
      if (e.type=="init") {
        if (e.code || !SetUser(user.c_str(),"书院录制")) { exitCode=4; finished=true; break; }
        SetToken(token.c_str(),room.c_str());
        if (!LoginRoom(room.c_str())) { exitCode=5; finished=true; break; }
      } else if (e.type=="login") {
        emit("login",e.code); if (e.code) { exitCode=6; finished=true; } else loggedIn=true;
      } else if (e.type=="stream" && !recording && !stopping) {
        ZegoRecordSingleStreamConfig config; config.enableAdjustTimestamp=true; config.enableFillInterruption=false;
        const std::string path=directory+"/part-"+std::to_string(++part)+".mp4";
        recording=StartRecordSingleStream(callback.stream.c_str(),path.c_str(),MuxerStreamTypeBoth,2,&config,room.c_str());
        nextRecordAttempt=std::chrono::steady_clock::now()+std::chrono::seconds(2);
        if (!recording) emit("waiting",7);
      } else if (e.type=="ended") {
        recording=false; if (stopping) finished=true; else { emit("error",e.code); exitCode=8; finished=true; }
      } else if (e.type=="disconnect") { emit("error",e.code); exitCode=9; finished=true; }
    }
    pollfd fd{STDIN_FILENO,POLLIN,0};
    if (poll(&fd,1,250)>0) {
      char buffer[8192]; auto bytes=read(STDIN_FILENO,buffer,sizeof(buffer));
      if (bytes<=0) interrupted=1;
      else {
        input.append(buffer,static_cast<size_t>(bytes));
        if (input.size()>16384) { exitCode=2; interrupted=1; }
        size_t end;
        while ((end=input.find('\n'))!=std::string::npos) {
          auto line=input.substr(0,end);input.erase(0,end+1);
          if (line=="STOP") interrupted=1;
          else if (line.rfind("TOKEN ",0)==0) SetToken(line.substr(6).c_str(),room.c_str());
        }
      }
    }
    const auto now=std::chrono::steady_clock::now();
    // WHIP publishers may not announce in the recorder's RTC room; subscribe to the known stream explicitly.
    if (loggedIn && !recording && !stopping && now>=nextRecordAttempt) { enqueue("stream"); nextRecordAttempt=now+std::chrono::seconds(2); }
    if (interrupted && !stopping) {
      stopping=true;stopTime=now;
      if (!recording || !StopRecordSingleStream(callback.stream.c_str())) finished=true;
    }
    if ((stopping && now-stopTime>std::chrono::seconds(15)) || now-started>std::chrono::hours(24)) finished=true;
  }
  LogoutRoom(room.c_str());SetCallback(nullptr);UnInitSDK();emit("stopped",exitCode);return exitCode;
}
