package main

import (
	"flag"
	"log"
	"os"
	"time"
)

func main() {
	var listenAddr string
	var targetAddr string
	var webDir string
	var tcpDialTimeout time.Duration

	flag.StringVar(&listenAddr, "listen", "0.0.0.0:39380", "address to listen on")
	flag.StringVar(&targetAddr, "target", "127.0.0.1:5901", "target TCP host:port")
	flag.StringVar(&webDir, "web-dir", "/usr/share/novnc", "directory containing noVNC assets")
	flag.DurationVar(&tcpDialTimeout, "dial-timeout", 5*time.Second, "timeout for dialing the VNC backend")
	flag.Parse()

	logger := log.New(os.Stdout, "", log.LstdFlags|log.LUTC)

	proxy, err := NewProxy(ProxyConfig{
		ListenAddr:  listenAddr,
		TargetAddr:  targetAddr,
		WebRoot:     webDir,
		DialTimeout: tcpDialTimeout,
		Logger:      logger,
	})
	if err != nil {
		logger.Fatalf("failed to initialize proxy: %v", err)
	}

	if err := proxy.Run(); err != nil {
		logger.Fatalf("proxy exited: %v", err)
	}
}
