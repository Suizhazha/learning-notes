# 函数进阶

# 默认参数
def greet(name, greeting="Hello"):
    print(f"{greeting}, {name}!")

greet("Alice")           # Hello, Alice!
greet("Alice", "Hi")     # Hi, Alice!

# *args 可变位置参数
def add_all(*args):
    print(type(args))  # <class 'tuple'>
    return sum(args)

print(add_all(1, 2, 3))  # 6
print(add_all(1, 2, 3, 4, 5))  # 15

# **kwargs 可变关键字参数
def print_info(**kwargs):
    print(type(kwargs))  # <class 'dict'>
    for key, value in kwargs.items():
        print(f"{key}: {value}")

print_info(name="Alice", age=25, city="Beijing")

# 参数顺序：普通参数 -> 默认参数 -> *args -> **kwargs
def func(a, b, c="default", *args, **kwargs):
    print(f"a={a}, b={b}, c={c}")
    print(f"args={args}")
    print(f"kwargs={kwargs}")

func(1, 2, 3, 4, 5, x=6, y=7)

# lambda 匿名函数
square = lambda x: x ** 2
print(square(5))  # 25

add = lambda x, y: x + y
print(add(3, 4))  # 7

# lambda 与 sorted/map/filter 配合使用
students = [
    {"name": "Alice", "score": 85},
    {"name": "Bob", "score": 92},
    {"name": "Charlie", "score": 78},
]

sorted_students = sorted(students, key=lambda s: s["score"], reverse=True)
print(sorted_students)

# map() 对每个元素应用函数
numbers = [1, 2, 3, 4, 5]
squared = list(map(lambda x: x ** 2, numbers))
print(squared)  # [1, 4, 9, 16, 25]

# filter() 过滤元素
even_numbers = list(filter(lambda x: x % 2 == 0, numbers))
print(even_numbers)  # [2, 4]

# 闭包
def outer(msg):
    def inner():
        print(f"消息: {msg}")
    return inner

hello = outer("Hello")
world = outer("World")
hello()  # 消息: Hello
world()  # 消息: World

# 装饰器基础
def timer(func):
    import time
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        end = time.time()
        print(f"{func.__name__} 耗时: {end - start:.4f}秒")
        return result
    return wrapper

@timer
def slow_function():
    import time
    time.sleep(1)
    print("函数执行完毕")

slow_function()

# 装饰器带参数
def repeat(times):
    def decorator(func):
        def wrapper(*args, **kwargs):
            for _ in range(times):
                result = func(*args, **kwargs)
            return result
        return wrapper
    return decorator

@repeat(times=3)
def say_hello():
    print("Hello!")

say_hello()
