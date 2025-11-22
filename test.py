import redis

r = redis.from_url(
    "redis://default:l5HvYfFux30wadX2vxQCsGN7oxPN7SKv@redis-14278.c273.us-east-1-2.ec2.cloud.redislabs.com:14278"
)
print(r) 
