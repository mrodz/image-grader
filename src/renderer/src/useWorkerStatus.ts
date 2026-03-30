import { useEffect, useState } from 'react'

export function useWorkerStatus() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // 1. Check if the worker is ALREADY ready (solves the race condition)
    window.api.getWorkerStatus().then((status) => {
        


    console.log(`already started up, status is: ${status.ready}`)
      if (status.ready) setIsReady(true)
    })

    // 2. Listen for the event in case it's still booting up
    window.api.onWorkerReady(() => {
        console.log(`worker is now live`)    
      setIsReady(true)
    })

    // Cleanup listener on unmount
    return () => {
      window.api.offWorkerReady()
    }
  }, [])

  return isReady
}